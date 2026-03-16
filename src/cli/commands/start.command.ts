import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { loadEnv } from "../../backend/config/env.schema.js";
import { startServer } from "../../backend/server.js";
import {
  writePidFile,
  isServerRunning,
  readPidFile,
  getPidDir,
} from "../daemon.js";
import { isErr } from "@shared/result.js";

export interface StartCommandOptions {
  readonly serverOnly: boolean;
  readonly adminOnly: boolean;
  readonly daemon: boolean;
}

export async function executeStartCommand(
  options: StartCommandOptions
): Promise<void> {
  // Load environment configuration
  const envResult = loadEnv();
  if (isErr(envResult)) {
    console.error("Failed to load environment configuration:");
    console.error(envResult.error.message);
    if (envResult.error.details) {
      console.error("Details:", envResult.error.details);
    }
    process.exit(1);
  }

  const config = envResult.value;

  // Check if server is already running
  if (isServerRunning()) {
    const existingPid = readPidFile();
    console.log(`Server is already running (PID: ${existingPid})`);
    process.exit(0);
  }

  // Handle daemon mode
  if (options.daemon) {
    console.log("Starting server in daemon mode...");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const scriptPath = resolve(__dirname, "../../backend/server.js");

    const child = fork(scriptPath, [], {
      detached: true,
      stdio: "ignore",
    });

    if (child.pid) {
      await writePidFile(child.pid);
      console.log(`Server started in background (PID: ${child.pid})`);
      console.log(`PID file: ${getPidDir()}/server.pid`);
      console.log(
        `Admin panel: http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`
      );

      // Don't wait for child process
      child.unref();
      process.exit(0);
    } else {
      console.error("Failed to start server in daemon mode");
      process.exit(1);
    }
  } else {
    // Run in foreground
    console.log("Starting server...");
    console.log(
      `Admin panel: http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`
    );

    // Write PID file for this process
    await writePidFile(process.pid);

    // Handle graceful shutdown
    const cleanup = (): void => {
      console.log("\nShutting down server...");
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    await startServer(config);
  }
}
