import { readPidFile, isServerRunning, getPidDir } from "../daemon.js";
import { loadEnv } from "../../backend/config/env.schema.js";
import { isErr } from "@shared/result.js";

export async function executeStatusCommand(): Promise<void> {
  const pid = readPidFile();
  const running = isServerRunning();

  // Load config to show admin panel URL
  const envResult = loadEnv();
  const adminPort = isErr(envResult)
    ? 3101
    : envResult.value.CLAUDE_MCP_ADMIN_PORT;

  console.error("Server Status");
  console.error("=".repeat(50));

  if (!pid) {
    console.error("Status: Not running (no PID file)");
  } else if (running) {
    console.error(`Status: Running`);
    console.error(`PID: ${pid}`);
    console.error(
      `Admin Panel: http://localhost:${adminPort}`
    );
  } else {
    console.error(`Status: Not running (stale PID file: ${pid})`);
  }

  console.error(`PID File: ${getPidDir()}/server.pid`);
  console.error("=".repeat(50));

  process.exit(running ? 0 : 1);
}
