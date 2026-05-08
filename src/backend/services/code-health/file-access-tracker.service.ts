import { extname } from "node:path";
import type { CodeHealthService } from "./code-health.service.js";
import type { CodeHealthBackgroundJobsRepository } from "../../db/repositories/code-health-background-jobs.repository.js";
import type { CodeHealthEventsRepository } from "../../db/repositories/code-health-events.repository.js";
import { isOk } from "@shared/result.js";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".java"]);
const DEBOUNCE_HOURS = 24;
const WORKER_INTERVAL_MS = 2_000;
const MAX_QUEUE_SIZE = 200;

type QueueItem = {
  readonly filePath: string;
  readonly triggerTool: string;
};

export type FileAccessTrackerDeps = {
  codeHealthService: CodeHealthService;
  backgroundJobsRepo: CodeHealthBackgroundJobsRepository;
  eventsRepo: CodeHealthEventsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export type FileAccessTracker = {
  recordFileRead(filePath: string, triggerTool: string): void;
  getActiveJobCount(): number;
  shutdown(): void;
};

export function createFileAccessTracker(deps: FileAccessTrackerDeps): FileAccessTracker {
  const queue: QueueItem[] = [];
  let activeCount = 0;
  let processing = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  function isSupportedFile(filePath: string): boolean {
    return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase());
  }

  async function processQueue(): Promise<void> {
    if (processing || queue.length === 0) return;
    processing = true;

    try {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;

        await processItem(item);
      }
    } finally {
      processing = false;
    }
  }

  async function processItem(item: QueueItem): Promise<void> {
    const { filePath, triggerTool } = item;

    try {
      // Debounce: check if file was analyzed in the last 24 hours
      const sinceIso = new Date(Date.now() - DEBOUNCE_HOURS * 60 * 60 * 1000).toISOString();
      const recent = await deps.backgroundJobsRepo.findRecentByFilePath(filePath, sinceIso);
      if (recent) {
        deps.logger.info("Background analysis skipped (debounce)", { filePath, lastAnalyzed: recent.createdAt });
        return;
      }

      // Create job record
      const job = await deps.backgroundJobsRepo.create({
        filePath,
        triggerTool,
        status: "queued",
      });

      activeCount++;

      // Update to running
      await deps.backgroundJobsRepo.update(job.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });

      // Run analysis
      const result = await deps.codeHealthService.analyzeFile(filePath, {
        includePerFunctionMetrics: false,
        includeSuggestions: true,
      });

      if (isOk(result)) {
        const report = result.value;
        await deps.backgroundJobsRepo.update(job.id, {
          status: "completed",
          score: report.score.overall,
          grade: report.score.grade,
          issueCount: report.score.issues.length,
          issuesJson: JSON.stringify(report.score.issues),
          completedAt: new Date().toISOString(),
        });

        // Record event
        await deps.eventsRepo.create({
          eventType: "post_commit_analysis",
          filePath,
          afterScore: report.score.overall,
          issuesFound: report.score.issues.length,
          trigger: "tool_read",
          contextJson: JSON.stringify({ triggerTool }),
        });

        deps.logger.info("Background analysis completed", {
          filePath,
          score: report.score.overall,
          grade: report.score.grade,
        });
      } else {
        await deps.backgroundJobsRepo.update(job.id, {
          status: "failed",
          errorMessage: "Analysis failed",
          completedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      deps.logger.error("Background analysis error", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      activeCount = Math.max(0, activeCount - 1);
    }
  }

  // Start the worker
  intervalId = setInterval(() => {
    processQueue().catch((err) => {
      deps.logger.error("Background analysis worker error", { error: String(err) });
    });
  }, WORKER_INTERVAL_MS);

  return {
    recordFileRead(filePath: string, triggerTool: string): void {
      if (!isSupportedFile(filePath)) return;
      if (queue.length >= MAX_QUEUE_SIZE) return;

      // Deduplicate within the current queue
      if (queue.some((q) => q.filePath === filePath)) return;

      queue.push({ filePath, triggerTool });
    },

    getActiveJobCount(): number {
      return activeCount + queue.length;
    },

    shutdown(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
  };
}
