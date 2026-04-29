import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  registerStartPrReviewSessionTool,
  type StartPrReviewSessionToolDeps,
} from "./start-pr-review-session.tool.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = "octocat";
const REPO = "hello-world";
const PR_NUMBER = 42;
const SESSION_ID = "session-abc-123";

function makeSession(overrides: Partial<ReturnType<typeof baseSession>> = {}) {
  return {
    ...baseSession(),
    ...overrides,
  };
}

function baseSession() {
  return {
    id: SESSION_ID,
    owner: OWNER,
    repo: REPO,
    prNumber: PR_NUMBER,
    status: "reviewing",
    errorMessage: null,
    createdAt: "2026-04-29T10:00:00.000Z",
    completedAt: null,
  };
}

const DEFAULT_CONFIGS = [
  {
    id: "cfg-1",
    owner: OWNER,
    repo: REPO,
    agentId: "backend-pr-reviewer",
    aiTool: "claude",
    enabled: 1,
    requiresExplicitSelection: 0,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "cfg-2",
    owner: OWNER,
    repo: REPO,
    agentId: "backend-pr-reviewer",
    aiTool: "gemini",
    enabled: 1,
    requiresExplicitSelection: 0,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  },
  {
    id: "cfg-3",
    owner: OWNER,
    repo: REPO,
    agentId: "backend-pr-reviewer",
    aiTool: "codex",
    enabled: 0,
    requiresExplicitSelection: 1,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(
  overrides: Partial<StartPrReviewSessionToolDeps> = {}
): StartPrReviewSessionToolDeps {
  const repoReviewConfigsRepo: RepoReviewConfigsRepository = {
    findByOwnerRepo: vi.fn().mockResolvedValue([]),
    upsertConfig: vi.fn(),
    createDefaults: vi.fn().mockResolvedValue(DEFAULT_CONFIGS),
  };

  const reviewSessionsRepo: ReviewSessionsRepository = {
    create: vi.fn().mockResolvedValue(makeSession()),
    findById: vi.fn().mockResolvedValue(undefined),
    findActiveByPr: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
  };

  return {
    repoReviewConfigsRepo,
    reviewSessionsRepo,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

async function setupMcpToolTest(deps: StartPrReviewSessionToolDeps) {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });
  registerStartPrReviewSessionTool(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client };
}

function parseResponse(result: unknown) {
  const r = result as { content: Array<{ type: string; text: string }> };
  const text = r.content[0]?.text ?? "";
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("registerStartPrReviewSessionTool (MCP transport)", () => {
  let deps: StartPrReviewSessionToolDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  it("is listed with the correct tool name", async () => {
    const { client } = await setupMcpToolTest(deps);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "start_pr_review_session");
    expect(tool).toBeDefined();
  });

  describe("happy path — no existing configs (auto-creates defaults)", () => {
    it("creates a session and returns sessionId and enabledAgents", async () => {
      // findByOwnerRepo returns empty → createDefaults is called
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResponse(result);
      expect(body.sessionId).toBe(SESSION_ID);
      expect(body.owner).toBe(OWNER);
      expect(body.repo).toBe(REPO);
      expect(body.prNumber).toBe(PR_NUMBER);
      expect(body.status).toBe("reviewing");
    });

    it("calls createDefaults when no config rows exist", async () => {
      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(deps.repoReviewConfigsRepo.createDefaults).toHaveBeenCalledWith(OWNER, REPO);
    });

    it("returns only enabled agents (claude and gemini, not codex)", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResponse(result);
      const aiTools: string[] = body.enabledAgents.map(
        (a: { aiTool: string }) => a.aiTool
      );
      expect(aiTools).toContain("claude");
      expect(aiTools).toContain("gemini");
      expect(aiTools).not.toContain("codex");
    });

    it("returns suggestedGoal containing sessionId and PR details", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      const body = parseResponse(result);
      for (const agent of body.enabledAgents as Array<{ suggestedGoal: string }>) {
        expect(agent.suggestedGoal).toContain(`PR #${PR_NUMBER}`);
        expect(agent.suggestedGoal).toContain(`${OWNER}/${REPO}`);
        expect(agent.suggestedGoal).toContain(SESSION_ID);
        expect(agent.suggestedGoal).toContain("store_agent_review_draft");
      }
    });

    it("returns instructions containing the sessionId and synthesiser hint", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      const body = parseResponse(result);
      expect(body.instructions).toContain(SESSION_ID);
      expect(body.instructions).toContain("review-synthesiser");
    });
  });

  describe("happy path — existing configs with explicit settings", () => {
    it("does not call createDefaults when configs already exist", async () => {
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(DEFAULT_CONFIGS);

      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(deps.repoReviewConfigsRepo.createDefaults).not.toHaveBeenCalled();
    });

    it("filters out codex when requiresExplicitSelection is true and codex is disabled", async () => {
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(DEFAULT_CONFIGS);

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      const body = parseResponse(result);
      const aiTools: string[] = body.enabledAgents.map(
        (a: { aiTool: string }) => a.aiTool
      );
      expect(aiTools).not.toContain("codex");
      expect(aiTools).toHaveLength(2);
    });
  });

  describe("idempotency — existing active session", () => {
    it("returns the existing session rather than creating a duplicate", async () => {
      const existingSession = makeSession({ status: "reviewing" });
      vi.mocked(deps.reviewSessionsRepo.findActiveByPr).mockResolvedValue(existingSession);
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(DEFAULT_CONFIGS);

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResponse(result);
      expect(body.sessionId).toBe(SESSION_ID);
      expect(deps.reviewSessionsRepo.create).not.toHaveBeenCalled();
    });

    it("does not call create when active session exists", async () => {
      vi.mocked(deps.reviewSessionsRepo.findActiveByPr).mockResolvedValue(
        makeSession({ status: "synthesising" })
      );
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(DEFAULT_CONFIGS);

      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(deps.reviewSessionsRepo.create).not.toHaveBeenCalled();
    });
  });

  describe("error cases", () => {
    it("returns isError when all tools are disabled", async () => {
      const allDisabledConfigs = DEFAULT_CONFIGS.map((c) => ({ ...c, enabled: 0 }));
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(allDisabledConfigs);

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBe(true);
      const body = parseResponse(result);
      expect(body.error).toContain("No AI tools are enabled");
      expect(body.owner).toBe(OWNER);
      expect(body.repo).toBe(REPO);
    });

    it("does not create a session when all tools are disabled", async () => {
      const allDisabledConfigs = DEFAULT_CONFIGS.map((c) => ({ ...c, enabled: 0 }));
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(allDisabledConfigs);

      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(deps.reviewSessionsRepo.create).not.toHaveBeenCalled();
    });

    it("returns isError when auto-created defaults are all disabled (edge case)", async () => {
      // createDefaults returns all disabled
      vi.mocked(deps.repoReviewConfigsRepo.createDefaults).mockResolvedValue(
        DEFAULT_CONFIGS.map((c) => ({ ...c, enabled: 0 }))
      );

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBe(true);
    });

    it("returns isError when session creation fails", async () => {
      vi.mocked(deps.repoReviewConfigsRepo.findByOwnerRepo).mockResolvedValue(DEFAULT_CONFIGS);
      vi.mocked(deps.reviewSessionsRepo.create).mockRejectedValue(
        new Error("SQLite constraint violation")
      );

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBe(true);
      const body = parseResponse(result);
      expect(body.error).toBe("Failed to create review session");
    });

    it("returns isError for invalid input (prNumber = 0)", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { owner: OWNER, repo: REPO, prNumber: 0 },
      });

      expect(result.isError).toBe(true);
    });

    it("returns isError for missing owner", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "start_pr_review_session",
        arguments: { repo: REPO, prNumber: PR_NUMBER },
      });

      expect(result.isError).toBe(true);
    });
  });
});
