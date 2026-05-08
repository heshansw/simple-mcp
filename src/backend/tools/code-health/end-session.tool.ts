import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import { EndSessionInputSchema } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthSessionsRepository } from "../../db/repositories/code-health-sessions.repository.js";
import type { CodeHealthEventsRepository } from "../../db/repositories/code-health-events.repository.js";
import type { SessionSummary } from "@shared/schemas/code-health.schema.js";

export type EndSessionToolDeps = {
  codeHealthService: CodeHealthService;
  sessionsRepo: CodeHealthSessionsRepository;
  eventsRepo: CodeHealthEventsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerEndSessionTool(server: McpServer, deps: EndSessionToolDeps): void {
  server.tool(
    "code_health_end_session",
    "End a coding session and persist final scores. Returns session summary with before/after comparisons and improvement metrics.",
    EndSessionInputSchema.shape,
    async (args) => {
      try {
        const input = EndSessionInputSchema.parse(args);
        const { sessionId } = input;

        deps.logger.info("Ending code health session", { sessionId });

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

        // 3. Final analysis of all tracked files
        const finalScores: Record<string, number> = {};
        for (const filePath of filesChanged) {
          const result = await deps.codeHealthService.analyzeFile(filePath, {
            includeSuggestions: false,
            includePerFunctionMetrics: false,
          });

          if (isErr(result)) {
            deps.logger.error("Failed to analyze file for final score", { filePath, error: domainErrorMessage(result.error) });
            // Use initial score as fallback so we don't penalize for analysis failures
            finalScores[filePath] = initialScores[filePath] ?? 0;
            continue;
          }

          finalScores[filePath] = result.value.score.overall;
        }

        // 4. Determine if target was achieved
        const achievedTarget = filesChanged.every(
          (fp) => (finalScores[fp] ?? 0) >= session.targetScore,
        );

        // 5. Update session record
        const now = new Date().toISOString();
        await deps.sessionsRepo.update(sessionId, {
          status: "completed",
          completedAt: now,
          finalScoresJson: JSON.stringify(finalScores),
          achievedTarget: achievedTarget ? 1 : 0,
        });

        // 6. Log events for each file
        for (const filePath of filesChanged) {
          const beforeScore = initialScores[filePath] ?? 0;
          const afterScore = finalScores[filePath] ?? 0;

          await deps.eventsRepo.create({
            eventType: "post_commit_analysis",
            filePath,
            beforeScore,
            afterScore,
            issuesFound: 0,
            issuesResolved: 0,
            iterations: session.totalIterations,
            trigger: "manual",
            contextJson: JSON.stringify({ sessionId }),
          });
        }

        // 7. Build summary
        const summary: SessionSummary = {
          sessionId,
          status: "completed",
          directoryPath: session.directoryPath,
          filesChanged,
          initialScores,
          finalScores,
          totalIterations: session.totalIterations,
          targetScore: session.targetScore,
          achievedTarget,
          startedAt: session.startedAt,
          completedAt: now,
        };

        deps.logger.info("Code health session ended", {
          sessionId,
          achievedTarget,
          totalIterations: session.totalIterations,
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
