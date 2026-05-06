import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import type { Logger } from "pino";
import type { Result, DomainError } from "@shared/result";
import { ok, err, integrationError } from "@shared/result.js";
import type { GeminiCliConfig } from "@shared/schemas/gemini-cli.schema";

// Ensure nvm-installed globals (like `gemini`) are discoverable even when the
// MCP server runs under a different Node version than the one where the CLI
// was installed (e.g. server on Node 22, gemini installed under Node 20).
function buildSpawnEnv(): NodeJS.ProcessEnv {
  const currentPath = process.env["PATH"] ?? "";
  const extra: string[] = [];

  // Add the current Node binary's directory
  const nodeBinDir = dirname(process.execPath);
  if (!currentPath.includes(nodeBinDir)) extra.push(nodeBinDir);

  // Add all nvm node version bin directories (covers cross-version installs)
  try {
    const nvmDir = process.env["NVM_DIR"] ?? join(homedir(), ".nvm");
    const versionsDir = join(nvmDir, "versions", "node");
    for (const entry of readdirSync(versionsDir)) {
      const binDir = join(versionsDir, entry, "bin");
      if (!currentPath.includes(binDir) && !extra.includes(binDir)) {
        extra.push(binDir);
      }
    }
  } catch {
    // nvm not installed or versions dir unreadable — skip
  }

  if (extra.length === 0) return process.env;
  return { ...process.env, PATH: `${currentPath}:${extra.join(":")}` };
}

// ── Types ────────────────────────────────────────────────────────────────

export type GeminiCliResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly model: string;
};

export type GeminiCliAvailability = {
  readonly version: string;
};

export type GeminiCliService = {
  readonly isAvailable: () => Promise<Result<GeminiCliAvailability, DomainError>>;
  readonly execute: (prompt: string, model?: string) => Promise<Result<GeminiCliResult, DomainError>>;
};

type GeminiCliServiceDeps = {
  readonly logger: Logger;
  readonly config: GeminiCliConfig;
};

// ── Implementation ───────────────────────────────────────────────────────

function spawnAndCapture(
  command: string,
  args: readonly string[],
  stdin: string | null,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let settled = false;

    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: controller.signal,
      env: buildSpawnEnv(),
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (controller.signal.aborted) {
        reject(new Error(`Gemini CLI timed out after ${timeoutMs}ms`));
      } else {
        reject(error);
      }
    });

    if (stdin !== null && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

export function createGeminiCliService(deps: GeminiCliServiceDeps): GeminiCliService {
  const { logger, config } = deps;

  return {
    async isAvailable(): Promise<Result<GeminiCliAvailability, DomainError>> {
      try {
        const result = await spawnAndCapture(
          config.binaryPath,
          ["--version"],
          null,
          5_000
        );

        if (result.exitCode !== 0) {
          return err(
            integrationError(
              "gemini-cli",
              `Gemini CLI exited with code ${result.exitCode}: ${result.stderr.trim()}`
            )
          );
        }

        const version = result.stdout.trim() || "unknown";
        logger.info({ version }, "Gemini CLI detected");
        return ok({ version });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return err(
          integrationError("gemini-cli", `Gemini CLI not available: ${message}`)
        );
      }
    },

    async execute(
      prompt: string,
      model?: string
    ): Promise<Result<GeminiCliResult, DomainError>> {
      const effectiveModel = model ?? config.model;
      const args = ["-p", "", "-m", effectiveModel, "-o", "text"];

      logger.info(
        { model: effectiveModel, promptLength: prompt.length },
        "Invoking Gemini CLI"
      );

      const startMs = Date.now();

      try {
        const result = await spawnAndCapture(
          config.binaryPath,
          args,
          prompt,
          config.timeoutMs
        );
        const durationMs = Date.now() - startMs;

        if (result.exitCode !== 0) {
          logger.error(
            { exitCode: result.exitCode, stderr: result.stderr.substring(0, 500) },
            "Gemini CLI exited with error"
          );
          return err(
            integrationError(
              "gemini-cli",
              `Gemini CLI exited with code ${result.exitCode}: ${result.stderr.substring(0, 500).trim()}`
            )
          );
        }

        if (!result.stdout.trim()) {
          return err(
            integrationError("gemini-cli", "Gemini CLI produced no output")
          );
        }

        logger.info(
          { durationMs, outputLength: result.stdout.length },
          "Gemini CLI execution completed"
        );

        return ok({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs,
          model: effectiveModel,
        });
      } catch (error) {
        const durationMs = Date.now() - startMs;
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ error: message, durationMs }, "Gemini CLI execution failed");
        return err(integrationError("gemini-cli", message));
      }
    },
  };
}
