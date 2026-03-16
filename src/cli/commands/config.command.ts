import { execSync } from "node:child_process";
import { platform } from "node:os";
import { loadEnv } from "../../backend/config/env.schema.js";
import { isErr } from "@shared/result.js";

export async function executeConfigCommand(): Promise<void> {
  // Load config to get admin panel port
  const envResult = loadEnv();
  const adminPort = isErr(envResult)
    ? 3101
    : envResult.value.CLAUDE_MCP_ADMIN_PORT;

  const url = `http://localhost:${adminPort}`;

  console.log(`Opening admin panel: ${url}`);

  try {
    const cmd = getPlatformOpenCommand(url);
    execSync(cmd, { stdio: "ignore" });
  } catch (error) {
    console.error("Failed to open browser automatically");
    console.log(`Please open this URL manually: ${url}`);
    process.exit(1);
  }
}

function getPlatformOpenCommand(url: string): string {
  const plat = platform();

  if (plat === "darwin") {
    // macOS
    return `open "${url}"`;
  } else if (plat === "win32") {
    // Windows
    return `start "${url}"`;
  } else {
    // Linux and others
    return `xdg-open "${url}"`;
  }
}
