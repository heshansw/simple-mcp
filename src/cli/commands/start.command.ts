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

  // Handle daemon mode
  if (options.daemon) {
    // In daemon mode: check for an existing instance to avoid duplicates
    if (isServerRunning()) {
      const existingPid = readPidFile();
      console.error(`Server is already running in daemon mode (PID: ${existingPid})`);
      process.exit(0);
    }

    console.error("Starting server in daemon mode...");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const scriptPath = resolve(__dirname, "../../backend/server.js");

    const child = fork(scriptPath, [], {
      detached: true,
      stdio: "ignore",
    });

    if (child.pid) {
      await writePidFile(child.pid);
      console.error(`Server started in background (PID: ${child.pid})`);
      console.error(`PID file: ${getPidDir()}/server.pid`);
      console.error(
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
    // Foreground / stdio mode — the MCP client owns the process lifecycle.
    // Never check for an existing PID here: an MCP client may spawn this
    // process multiple times during protocol negotiation, and an early exit
    // caused by a stale PID file would tear down the active connection.
    console.error("Starting server...");
    console.error(
      `Admin panel: http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`
    );

    // Handle graceful shutdown
    const cleanup = (): void => {
      console.error("\nShutting down server...");
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    await startServer(config);
  }
}
