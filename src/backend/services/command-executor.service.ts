import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export type CommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

export type CommandExecutor = {
  /** Run a command with args, returning stdout/stderr/exitCode */
  run(command: string, args: string[], timeoutMs?: number): Promise<CommandResult>;
  /** Check if a file exists (on host for local, inside container for docker) */
  fileExists(path: string): Promise<boolean>;
  /** Translate a host path to the execution environment path */
  mapPath(hostPath: string): string;
};

export type AudioSandboxMode = "local" | "docker";

export type VolumeMapping = {
  readonly hostPath: string;
  readonly containerPath: string;
};

// ── Local executor ───────────────────────────────────────────────────────

export function createLocalCommandExecutor(): CommandExecutor {
  const envPath = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    process.env.PATH ?? "",
  ].join(":");

  return {
    run(command: string, args: string[], timeoutMs = 600_000): Promise<CommandResult> {
      return new Promise((resolve) => {
        const proc = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, PATH: envPath },
        });

        let stdout = "";
        let stderr = "";

        proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
        proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          resolve({ stdout, stderr: stderr + "\nProcess timed out", exitCode: 124 });
        }, timeoutMs);

        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        });

        proc.on("error", (error) => {
          clearTimeout(timer);
          resolve({ stdout, stderr: error.message, exitCode: 127 });
        });
      });
    },

    async fileExists(path: string): Promise<boolean> {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },

    mapPath(hostPath: string): string {
      return hostPath;
    },
  };
}

// ── Docker executor ──────────────────────────────────────────────────────

export function createDockerCommandExecutor(
  containerName: string,
  volumeMappings: readonly VolumeMapping[]
): CommandExecutor {
  // Pre-resolve and sort by longest prefix first for correct matching
  const resolvedMappings = volumeMappings
    .map((m) => ({
      hostPath: resolve(m.hostPath),
      containerPath: m.containerPath,
    }))
    .sort((a, b) => b.hostPath.length - a.hostPath.length);

  function mapPath(hostPath: string): string {
    const resolved = resolve(hostPath);
    for (const mapping of resolvedMappings) {
      if (resolved.startsWith(mapping.hostPath)) {
        return resolved.replace(mapping.hostPath, mapping.containerPath);
      }
    }
    return hostPath;
  }

  function runOnHost(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({ stdout, stderr: stderr + "\nProcess timed out", exitCode: 124 });
      }, timeoutMs);

      proc.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on("error", (error) => {
        clearTimeout(timer);
        resolve({ stdout, stderr: error.message, exitCode: 127 });
      });
    });
  }

  return {
    run(command: string, args: string[], timeoutMs = 600_000): Promise<CommandResult> {
      return runOnHost(
        "docker",
        ["exec", containerName, command, ...args],
        timeoutMs
      );
    },

    async fileExists(path: string): Promise<boolean> {
      const result = await runOnHost(
        "docker",
        ["exec", containerName, "test", "-f", path],
        5_000
      );
      return result.exitCode === 0;
    },

    mapPath,
  };
}
