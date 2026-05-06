import { spawn } from "node:child_process";
import type { Logger } from "pino";
import {
  type Result,
  ok,
  err,
  integrationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";

// ── Types ────────────────────────────────────────────────────────────────

export type ContainerStatus = {
  readonly running: boolean;
  readonly containerName: string;
  readonly image: string | null;
};

export type DockerLifecycleService = {
  isDockerAvailable(): Promise<boolean>;
  getContainerStatus(containerName: string): Promise<Result<ContainerStatus, DomainError>>;
  ensureContainerRunning(composePath: string, containerName: string): Promise<Result<ContainerStatus, DomainError>>;
  stopContainer(composePath: string): Promise<Result<void, DomainError>>;
};

export type DockerLifecycleDependencies = {
  logger: Logger;
};

// ── Helpers ──────────────────────────────────────────────────────────────

function runShell(
  command: string,
  args: string[],
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
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

// ── Implementation ───────────────────────────────────────────────────────

export function createDockerLifecycleService(
  deps: DockerLifecycleDependencies
): DockerLifecycleService {
  const { logger } = deps;

  return {
    async isDockerAvailable(): Promise<boolean> {
      const result = await runShell("docker", ["--version"], 5_000);
      return result.exitCode === 0;
    },

    async getContainerStatus(containerName: string): Promise<Result<ContainerStatus, DomainError>> {
      const result = await runShell(
        "docker",
        ["inspect", "--format", "{{.State.Running}}|{{.Config.Image}}", containerName],
        10_000
      );

      if (result.exitCode !== 0) {
        return ok({
          running: false,
          containerName,
          image: null,
        });
      }

      const [runningStr, image] = result.stdout.trim().split("|");
      return ok({
        running: runningStr === "true",
        containerName,
        image: image ?? null,
      });
    },

    async ensureContainerRunning(
      composePath: string,
      containerName: string
    ): Promise<Result<ContainerStatus, DomainError>> {
      // Check if Docker is available
      const dockerAvailable = await this.isDockerAvailable();
      if (!dockerAvailable) {
        return err(integrationError(
          "docker",
          "Docker is not installed or not running. Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
        ));
      }

      // Check current container status
      const statusResult = await this.getContainerStatus(containerName);
      if (statusResult._tag === "Err") return statusResult;

      if (statusResult.value.running) {
        logger.info({ containerName }, "Audio sandbox container already running");
        return statusResult;
      }

      // Start container via docker compose
      logger.info({ composePath, containerName }, "Starting audio sandbox container");
      const upResult = await runShell(
        "docker",
        ["compose", "-f", composePath, "up", "-d", "--build"],
        600_000 // 10 min for first build (whisper-cpp compilation)
      );

      if (upResult.exitCode !== 0) {
        logger.error({ stderr: upResult.stderr.slice(0, 500) }, "Failed to start audio sandbox container");
        return err(integrationError(
          "docker",
          `Failed to start container: ${upResult.stderr.slice(0, 200)}`
        ));
      }

      // Verify it's running
      const verifyResult = await this.getContainerStatus(containerName);
      if (verifyResult._tag === "Err") return verifyResult;

      if (!verifyResult.value.running) {
        return err(integrationError(
          "docker",
          "Container started but is not running. Check logs: docker compose -f " + composePath + " logs"
        ));
      }

      logger.info({ containerName }, "Audio sandbox container started successfully");
      return verifyResult;
    },

    async stopContainer(composePath: string): Promise<Result<void, DomainError>> {
      logger.info({ composePath }, "Stopping audio sandbox container");
      const result = await runShell(
        "docker",
        ["compose", "-f", composePath, "down"],
        30_000
      );

      if (result.exitCode !== 0) {
        return err(integrationError(
          "docker",
          `Failed to stop container: ${result.stderr.slice(0, 200)}`
        ));
      }

      return ok(undefined);
    },
  };
}
