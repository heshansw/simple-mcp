import { readPidFile, removePidFile, isServerRunning } from "../daemon.js";

export async function executeStopCommand(): Promise<void> {
  const pid = readPidFile();

  if (!pid) {
    console.error("No running server found (no PID file)");
    process.exit(0);
  }

  if (!isServerRunning()) {
    console.error(`Server process (PID: ${pid}) is not running`);
    removePidFile();
    process.exit(0);
  }

  try {
    process.kill(pid, "SIGTERM");
    console.error(`Sent SIGTERM to process ${pid}`);

    // Wait a bit for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if process still exists
    if (isServerRunning()) {
      console.error("Server did not shut down gracefully, force killing...");
      process.kill(pid, "SIGKILL");
    }

    removePidFile();
    console.error("Server stopped");
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ESRCH") {
        console.error(`Process ${pid} not found`);
        removePidFile();
        process.exit(0);
      }
    }
    console.error("Failed to stop server:", error);
    process.exit(1);
  }
}
