import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";

const PID_DIR = `${homedir()}/.simple-mcp`;
const PID_FILE = `${PID_DIR}/server.pid`;

export async function writePidFile(pid: number): Promise<void> {
  await mkdir(PID_DIR, { recursive: true });
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function readPidFile(): number | null {
  if (!existsSync(PID_FILE)) {
    return null;
  }

  try {
    const content = readFileSync(PID_FILE, "utf-8").trim();
    const pid = parseInt(content, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch (error) {
    return null;
  }
}

export function removePidFile(): void {
  if (existsSync(PID_FILE)) {
    try {
      unlinkSync(PID_FILE);
    } catch (error) {
      // Fail silently
    }
  }
}

export function isServerRunning(): boolean {
  const pid = readPidFile();
  if (pid === null) {
    return false;
  }

  try {
    // Sending signal 0 checks if process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

export function getPidDir(): string {
  return PID_DIR;
}
