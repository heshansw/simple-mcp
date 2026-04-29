import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  registerStoreAgentReviewDraftTool,
  type StoreAgentReviewDraftToolDeps,
} from "./store-agent-review-draft.tool.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";
import type { ReviewSessionDraftsRepository } from "../../db/repositories/review-session-drafts.repository.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "session-abc-123";
const DRAFT_ID = "draft-xyz-789";
const AGENT_ID = "backend-pr-reviewer";

function makeSession(
  status: "pending" | "reviewing" | "synthesising" | "completed" | "failed" = "reviewing"
) {
  return {
    id: SESSION_ID,
    owner: "octocat",
    repo: "hello-world",
    prNumber: 42,
    status,
    errorMessage: null,
    createdAt: "2026-04-29T10:00:00.000Z",
    completedAt: null,
  };
}

function makeDraft(aiTool: string = "claude") {
  return {
    id: DRAFT_ID,
    sessionId: SESSION_ID,
    agentId: AGENT_ID,
    aiTool,
    runId: null,
    verdict: "APPROVE",
    body: "Looks great",
    commentsJson: "[]",
    createdAt: "2026-04-29T10:05:00.000Z",
  };
}

const VALID_DRAFT_ARGS = {
  sessionId: SESSION_ID,
  agentId: AGENT_ID,
  aiTool: "claude",
  verdict: "APPROVE",
  body: "This PR looks good overall.",
  comments: [
    {
      path: "src/index.ts",
      position: 3,
      body: "Minor nit: prefer const",
      category: "style",
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(
  overrides: Partial<StoreAgentReviewDraftToolDeps> = {}
): StoreAgentReviewDraftToolDeps {
  const reviewSessionsRepo: ReviewSessionsRepository = {
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(makeSession()),
    findActiveByPr: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
  };

  const reviewSessionDraftsRepo: ReviewSessionDraftsRepository = {
    upsertDraft: vi.fn().mockResolvedValue(makeDraft()),
    findBySessionId: vi.fn().mockResolvedValue([]),
    findBySessionAndTool: vi.fn().mockResolvedValue(undefined),
  };

  return {
    reviewSessionsRepo,
    reviewSessionDraftsRepo,
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

async function setupMcpToolTest(deps: StoreAgentReviewDraftToolDeps) {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });
  registerStoreAgentReviewDraftTool(server, deps);

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

describe("registerStoreAgentReviewDraftTool (MCP transport)", () => {
  let deps: StoreAgentReviewDraftToolDeps;

  beforeEach(() => {
    deps = createMockDeps();
    vi.clearAllMocks();
  });

  it("is listed with the correct tool name", async () => {
    const { client } = await setupMcpToolTest(deps);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "store_agent_review_draft");
    expect(tool).toBeDefined();
  });

  describe("happy path", () => {
    it("stores a draft successfully and returns draftId, sessionId, aiTool, commentCount", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBeFalsy();
      const body = parseResponse(result);
      expect(body.draftId).toBe(DRAFT_ID);
      expect(body.sessionId).toBe(SESSION_ID);
      expect(body.aiTool).toBe("claude");
      expect(body.commentCount).toBe(1);
    });

    it("stores a draft with empty comments array", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: { ...VALID_DRAFT_ARGS, comments: [] },
      });

      expect(result.isError).toBeFalsy();
      const body = parseResponse(result);
      expect(body.commentCount).toBe(0);
    });

    it("passes commentsJson as serialised JSON to the repository", async () => {
      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(deps.reviewSessionDraftsRepo.upsertDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: SESSION_ID,
          aiTool: "claude",
          commentsJson: JSON.stringify(VALID_DRAFT_ARGS.comments),
        })
      );
    });

    it("stores a draft with runId when provided", async () => {
      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "store_agent_review_draft",
        arguments: { ...VALID_DRAFT_ARGS, runId: "run-001" },
      });

      expect(deps.reviewSessionDraftsRepo.upsertDraft).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-001" })
      );
    });

    it("stores a draft with runId null when not provided", async () => {
      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(deps.reviewSessionDraftsRepo.upsertDraft).toHaveBeenCalledWith(
        expect.objectContaining({ runId: null })
      );
    });

    it("upsert overwrites existing draft for same session+aiTool (idempotency)", async () => {
      // First call returns a draft
      vi.mocked(deps.reviewSessionDraftsRepo.upsertDraft)
        .mockResolvedValueOnce(makeDraft("claude"))
        .mockResolvedValueOnce({ ...makeDraft("claude"), body: "Updated review body" });

      const { client } = await setupMcpToolTest(deps);

      // First store
      const first = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });
      expect(first.isError).toBeFalsy();

      // Second store (retry/overwrite)
      const second = await client.callTool({
        name: "store_agent_review_draft",
        arguments: { ...VALID_DRAFT_ARGS, body: "Updated review body" },
      });
      expect(second.isError).toBeFalsy();

      expect(deps.reviewSessionDraftsRepo.upsertDraft).toHaveBeenCalledTimes(2);
    });

    it("works for all valid aiTool values", async () => {
      for (const aiTool of ["claude", "gemini", "codex"]) {
        const depsCopy = createMockDeps();
        vi.mocked(depsCopy.reviewSessionDraftsRepo.upsertDraft).mockResolvedValue(
          makeDraft(aiTool)
        );
        const { client } = await setupMcpToolTest(depsCopy);

        const result = await client.callTool({
          name: "store_agent_review_draft",
          arguments: { ...VALID_DRAFT_ARGS, aiTool },
        });

        expect(result.isError).toBeFalsy();
        const body = parseResponse(result);
        expect(body.aiTool).toBe(aiTool);
      }
    });
  });

  describe("error cases — session validation", () => {
    it("returns isError when sessionId does not exist", async () => {
      vi.mocked(deps.reviewSessionsRepo.findById).mockResolvedValue(undefined);

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBe(true);
      const text =
        (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Session not found");
    });

    it("does not call upsertDraft when session not found", async () => {
      vi.mocked(deps.reviewSessionsRepo.findById).mockResolvedValue(undefined);

      const { client } = await setupMcpToolTest(deps);

      await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(deps.reviewSessionDraftsRepo.upsertDraft).not.toHaveBeenCalled();
    });

    it("returns isError when session status is completed", async () => {
      vi.mocked(deps.reviewSessionsRepo.findById).mockResolvedValue(
        makeSession("completed")
      );

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBe(true);
      const text =
        (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Session is already closed");
    });

    it("returns isError when session status is failed", async () => {
      vi.mocked(deps.reviewSessionsRepo.findById).mockResolvedValue(
        makeSession("failed")
      );

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBe(true);
      const text =
        (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Session is already closed");
    });

    it("accepts drafts for sessions in reviewing status", async () => {
      vi.mocked(deps.reviewSessionsRepo.findById).mockResolvedValue(
        makeSession("reviewing")
      );

      const { client } = await setupMcpToolTest(deps);
      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBeFalsy();
    });

    it("accepts drafts for sessions in synthesising status", async () => {
      vi.mocked(deps.reviewSessionsRepo.findById).mockResolvedValue(
        makeSession("synthesising")
      );

      const { client } = await setupMcpToolTest(deps);
      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBeFalsy();
    });

    it("returns isError when repository throws unexpectedly", async () => {
      vi.mocked(deps.reviewSessionDraftsRepo.upsertDraft).mockRejectedValue(
        new Error("disk full")
      );

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: VALID_DRAFT_ARGS,
      });

      expect(result.isError).toBe(true);
      const text =
        (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("disk full");
    });
  });

  describe("input validation", () => {
    it("returns isError when verdict is invalid", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: { ...VALID_DRAFT_ARGS, verdict: "REJECT" },
      });

      expect(result.isError).toBe(true);
      expect(deps.reviewSessionDraftsRepo.upsertDraft).not.toHaveBeenCalled();
    });

    it("returns isError when comment has position 0", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "store_agent_review_draft",
        arguments: {
          ...VALID_DRAFT_ARGS,
          comments: [{ path: "src/x.ts", position: 0, body: "bad", category: "bug" }],
        },
      });

      expect(result.isError).toBe(true);
    });
  });
});
