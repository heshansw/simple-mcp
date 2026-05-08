import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import { SessionCheckInputSchema } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthSessionsRepository } from "../../db/repositories/code-health-sessions.repository.js";
import type { CodeHealthEventsRepository } from "../../db/repositories/code-health-events.repository.js";

export type SessionCheckToolDeps = {
  codeHealthService: CodeHealthService;
  sessionsRepo: CodeHealthSessionsRepository;
  eventsRepo: CodeHealthEventsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

type FileCheckResult = {
  filePath: string;
  baselineScore: number;
  currentScore: number;
  delta: number;
  pass: boolean;
};

export function registerSessionCheckTool(server: McpServer, deps: SessionCheckToolDeps): void {
  server.tool(
    "code_health_session_check",
    "Check code quality of session-changed files. Compares against session baseline, returns fix suggestions. Use in a loop: check → fix → check until all files reach target score.",
    SessionCheckInputSchema.shape,
    async (args) => {
      try {
        const input = SessionCheckInputSchema.parse(args);
        const { sessionId } = input;

        deps.logger.info("Running session check", { sessionId });

        // 1. Load session
        const session = await deps.sessionsRepo.findById(sessionId);
        if (!session) {
          return {
            content: [{ type: "text" as const, text: `Error: Session not found: ${sessionId}` }],
            isError: true,
          };
        }
        if (session.status !== "active") {
          return {
            content: [{ type: "text" as const, text: `Error: Session is not active (status: ${session.status})` }],
            isError: true,
          };
        }

        // 2. Parse session data
        const filesChanged: string[] = JSON.parse(session.filesChanged) as string[];
        const initialScores: Record<string, number> = JSON.parse(session.initialScoresJson) as Record<string, number>;
        const targetScore = session.targetScore;
        const iterationNumber = session.totalIterations + 1;

        // 3. Check iteration limit
        if (session.totalIterations >= session.maxIterations) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                allPassed: false,
                maxIterationsReached: true,
                iterationNumber: session.totalIterations,
                maxIterations: session.maxIterations,
                message: `Maximum iterations (${session.maxIterations}) reached. End the session with code_health_end_session.`,
              }, null, 2),
            }],
          };
        }

        // 4. Analyze each file
        const filesChecked: FileCheckResult[] = [];
        const allSuggestions: Array<{ filePath: string; severity: string; signal: string; message: string; suggestion?: string; line?: number; functionName?: string }> = [];

        for (const filePath of filesChanged) {
          const result = await deps.codeHealthService.analyzeFile(filePath, {
            includeSuggestions: true,
            includePerFunctionMetrics: false,
          });

          if (isErr(result)) {
            deps.logger.error("Failed to analyze file during session check", { filePath, error: domainErrorMessage(result.error) });
            filesChecked.push({
              filePath,
              baselineScore: initialScores[filePath] ?? 0,
              currentScore: 0,
              delta: 0,
              pass: false,
            });
            continue;
          }

          const report = result.value;
          const baselineScore = initialScores[filePath] ?? 0;
          const currentScore = report.score.overall;
          const pass = currentScore >= targetScore;

          filesChecked.push({
            filePath,
            baselineScore,
            currentScore,
            delta: currentScore - baselineScore,
            pass,
          });

          // Collect suggestions for files that don't pass
          if (!pass) {
            for (const issue of report.score.issues) {
              allSuggestions.push({
                filePath,
                severity: issue.severity,
                signal: issue.signal,
                message: issue.message,
                ...(issue.suggestion != null ? { suggestion: issue.suggestion } : {}),
                ...(issue.line != null ? { line: issue.line } : {}),
                ...(issue.functionName != null ? { functionName: issue.functionName } : {}),
              });
            }
          }
        }

        const allPassed = filesChecked.every((f) => f.pass);

        // 5. Update session iteration count
        await deps.sessionsRepo.update(sessionId, {
          totalIterations: iterationNumber,
        });

        // 6. Log event
        const currentScores: Record<string, number> = {};
        for (const fc of filesChecked) {
          currentScores[fc.filePath] = fc.currentScore;
        }

        await deps.eventsRepo.create({
          eventType: "session_check",
          filePath: session.directoryPath,
          beforeScore: null,
          afterScore: null,
          issuesFound: allSuggestions.length,
          issuesResolved: 0,
          iterations: iterationNumber,
          trigger: "manual",
          contextJson: JSON.stringify({
            sessionId,
            iterationNumber,
            allPassed,
            currentScores,
          }),
        });

        const response = {
          allPassed,
          iterationNumber,
          maxIterations: session.maxIterations,
          maxIterationsReached: false,
          targetScore,
          filesChecked,
          suggestions: allSuggestions,
        };

        deps.logger.info("Session check complete", {
          sessionId,
          iterationNumber,
          allPassed,
          filesChecked: filesChecked.length,
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
