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

  console.log("Server Status");
  console.log("=".repeat(50));

  if (!pid) {
    console.log("Status: Not running (no PID file)");
  } else if (running) {
    console.log(`Status: Running`);
    console.log(`PID: ${pid}`);
    console.log(
      `Admin Panel: http://localhost:${adminPort}`
    );
  } else {
    console.log(`Status: Not running (stale PID file: ${pid})`);
  }

  console.log(`PID File: ${getPidDir()}/server.pid`);
  console.log("=".repeat(50));

  process.exit(running ? 0 : 1);
}
