import type { Logger } from "pino";

export interface TaskStatus {
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly isRunning: boolean;
}

export interface MaintenanceScheduler {
  registerTask(
    name: string,
    intervalMs: number,
    task: () => Promise<void>
  ): void;
  start(): void;
  stop(): void;
  runNow(name: string): Promise<void>;
  getStatus(): Map<string, TaskStatus>;
}

interface RegisteredTask {
  name: string;
  intervalMs: number;
  task: () => Promise<void>;
  intervalId: NodeJS.Timeout | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  isRunning: boolean;
}

export function createMaintenanceScheduler(deps: {
  readonly logger: Logger;
}): MaintenanceScheduler {
  const tasks = new Map<string, RegisteredTask>();

  function calculateNextRunAt(intervalMs: number): string {
    const nextRun = new Date(Date.now() + intervalMs);
    return nextRun.toISOString();
  }

  async function executeTask(taskName: string): Promise<void> {
    const registeredTask = tasks.get(taskName);
    if (!registeredTask) {
      deps.logger.warn({ taskName }, "Task not found");
      return;
    }

    if (registeredTask.isRunning) {
      deps.logger.debug({ taskName }, "Task already running, skipping");
      return;
    }

    registeredTask.isRunning = true;

    try {
      deps.logger.info({ taskName }, "Task starting");
      const startTime = Date.now();

      await registeredTask.task();

      const duration = Date.now() - startTime;
      registeredTask.lastRunAt = new Date().toISOString();
      registeredTask.nextRunAt = calculateNextRunAt(registeredTask.intervalMs);

      deps.logger.info(
        { taskName, durationMs: duration },
        "Task completed successfully"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      deps.logger.error(
        { taskName, error: errorMessage },
        "Task execution failed"
      );
    } finally {
      registeredTask.isRunning = false;
    }
  }

  return {
    registerTask(
      name: string,
      intervalMs: number,
      task: () => Promise<void>
    ): void {
      if (tasks.has(name)) {
        deps.logger.warn({ taskName: name }, "Task already registered");
        return;
      }

      const registeredTask: RegisteredTask = {
        name,
        intervalMs,
        task,
        intervalId: null,
        lastRunAt: null,
        nextRunAt: calculateNextRunAt(intervalMs),
        isRunning: false,
      };

      tasks.set(name, registeredTask);
      deps.logger.debug(
        { taskName: name, intervalMs },
        "Task registered"
      );
    },

    start(): void {
      if (tasks.size === 0) {
        deps.logger.warn("No tasks registered, nothing to start");
        return;
      }

      let startedCount = 0;

      for (const [taskName, registeredTask] of tasks) {
        if (registeredTask.intervalId !== null) {
          deps.logger.debug({ taskName }, "Task already started");
          continue;
        }

        registeredTask.intervalId = setInterval(() => {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          executeTask(taskName);
        }, registeredTask.intervalMs);

        registeredTask.nextRunAt = calculateNextRunAt(registeredTask.intervalMs);
        startedCount++;

        deps.logger.debug(
          { taskName, intervalMs: registeredTask.intervalMs },
          "Task started"
        );
      }

      deps.logger.info({ startedCount }, "Scheduler started");
    },

    stop(): void {
      let stoppedCount = 0;

      for (const registeredTask of tasks.values()) {
        if (registeredTask.intervalId !== null) {
          clearInterval(registeredTask.intervalId);
          registeredTask.intervalId = null;
          stoppedCount++;

          deps.logger.debug(
            { taskName: registeredTask.name },
            "Task stopped"
          );
        }
      }

      deps.logger.info({ stoppedCount }, "Scheduler stopped");
    },

    async runNow(name: string): Promise<void> {
      const registeredTask = tasks.get(name);
      if (!registeredTask) {
        deps.logger.warn({ taskName: name }, "Task not found");
        return;
      }

      await executeTask(name);
    },

    getStatus(): Map<string, TaskStatus> {
      const statusMap = new Map<string, TaskStatus>();

      for (const [name, registeredTask] of tasks) {
        statusMap.set(name, {
          lastRunAt: registeredTask.lastRunAt,
          nextRunAt: registeredTask.nextRunAt,
          isRunning: registeredTask.isRunning,
        });
      }

      return statusMap;
    },
  };
}
