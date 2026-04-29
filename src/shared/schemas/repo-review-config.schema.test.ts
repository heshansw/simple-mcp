import { describe, it, expect } from "vitest";
import {
  AiToolSchema,
  GetRepoReviewConfigInputSchema,
  SetRepoReviewConfigInputSchema,
  RepoReviewConfigSchema,
} from "./repo-review-config.schema.js";

// ---------------------------------------------------------------------------
// AiToolSchema
// ---------------------------------------------------------------------------

describe("AiToolSchema", () => {
  describe("acceptance", () => {
    it('accepts "claude"', () => {
      expect(AiToolSchema.safeParse("claude").success).toBe(true);
    });

    it('accepts "gemini"', () => {
      expect(AiToolSchema.safeParse("gemini").success).toBe(true);
    });

    it('accepts "codex"', () => {
      expect(AiToolSchema.safeParse("codex").success).toBe(true);
    });
  });

  describe("rejection", () => {
    it('rejects "gpt4"', () => {
      expect(AiToolSchema.safeParse("gpt4").success).toBe(false);
    });

    it("rejects empty string", () => {
      expect(AiToolSchema.safeParse("").success).toBe(false);
    });

    it("rejects unknown tool name", () => {
      expect(AiToolSchema.safeParse("anthropic").success).toBe(false);
    });

    it("rejects number input", () => {
      expect(AiToolSchema.safeParse(42).success).toBe(false);
    });

    it("rejects null", () => {
      expect(AiToolSchema.safeParse(null).success).toBe(false);
    });

    it("rejects uppercase variant", () => {
      expect(AiToolSchema.safeParse("CLAUDE").success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// RepoReviewConfigSchema
// ---------------------------------------------------------------------------

describe("RepoReviewConfigSchema", () => {
  const validConfig = {
    id: "cfg-123",
    owner: "octocat",
    repo: "hello-world",
    agentId: "backend-pr-reviewer",
    aiTool: "claude",
    enabled: true,
    requiresExplicitSelection: false,
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  };

  it("accepts a valid config object", () => {
    expect(RepoReviewConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it("rejects missing id", () => {
    const { id: _id, ...rest } = validConfig;
    expect(RepoReviewConfigSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty owner", () => {
    expect(RepoReviewConfigSchema.safeParse({ ...validConfig, owner: "" }).success).toBe(false);
  });

  it("rejects empty repo", () => {
    expect(RepoReviewConfigSchema.safeParse({ ...validConfig, repo: "" }).success).toBe(false);
  });

  it("rejects invalid aiTool value", () => {
    expect(RepoReviewConfigSchema.safeParse({ ...validConfig, aiTool: "gpt4" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GetRepoReviewConfigInputSchema
// ---------------------------------------------------------------------------

describe("GetRepoReviewConfigInputSchema", () => {
  describe("acceptance", () => {
    it("accepts valid owner and repo", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({
        owner: "octocat",
        repo: "hello-world",
      });
      expect(result.success).toBe(true);
    });

    it("accepts single-character owner and repo", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({
        owner: "x",
        repo: "y",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("rejection", () => {
    it("rejects empty owner", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({
        owner: "",
        repo: "hello-world",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty repo", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({
        owner: "octocat",
        repo: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing owner", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({ repo: "hello-world" });
      expect(result.success).toBe(false);
    });

    it("rejects missing repo", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({ owner: "octocat" });
      expect(result.success).toBe(false);
    });

    it("rejects numeric owner", () => {
      const result = GetRepoReviewConfigInputSchema.safeParse({ owner: 123, repo: "hello-world" });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// SetRepoReviewConfigInputSchema
// ---------------------------------------------------------------------------

describe("SetRepoReviewConfigInputSchema", () => {
  const validInput = {
    owner: "octocat",
    repo: "hello-world",
    aiTool: "claude",
    enabled: true,
  };

  describe("acceptance", () => {
    it("accepts minimal valid input (no optional fields)", () => {
      const result = SetRepoReviewConfigInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it("accepts input with optional agentId", () => {
      const result = SetRepoReviewConfigInputSchema.safeParse({
        ...validInput,
        agentId: "custom-agent",
      });
      expect(result.success).toBe(true);
    });

    it("accepts input with requiresExplicitSelection: false", () => {
      const result = SetRepoReviewConfigInputSchema.safeParse({
        ...validInput,
        aiTool: "codex",
        enabled: true,
        requiresExplicitSelection: false,
      });
      expect(result.success).toBe(true);
    });

    it("accepts input with enabled: false", () => {
      const result = SetRepoReviewConfigInputSchema.safeParse({ ...validInput, enabled: false });
      expect(result.success).toBe(true);
    });

    it("accepts all three aiTool values", () => {
      for (const aiTool of ["claude", "gemini", "codex"] as const) {
        const result = SetRepoReviewConfigInputSchema.safeParse({ ...validInput, aiTool });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("rejection", () => {
    it("rejects missing owner", () => {
      const { owner: _o, ...rest } = validInput;
      expect(SetRepoReviewConfigInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing repo", () => {
      const { repo: _r, ...rest } = validInput;
      expect(SetRepoReviewConfigInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing aiTool", () => {
      const { aiTool: _t, ...rest } = validInput;
      expect(SetRepoReviewConfigInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects invalid aiTool value", () => {
      expect(
        SetRepoReviewConfigInputSchema.safeParse({ ...validInput, aiTool: "gpt4" }).success
      ).toBe(false);
    });

    it("rejects empty owner", () => {
      expect(
        SetRepoReviewConfigInputSchema.safeParse({ ...validInput, owner: "" }).success
      ).toBe(false);
    });

    it("rejects empty repo", () => {
      expect(
        SetRepoReviewConfigInputSchema.safeParse({ ...validInput, repo: "" }).success
      ).toBe(false);
    });

    it("rejects empty agentId when provided", () => {
      expect(
        SetRepoReviewConfigInputSchema.safeParse({ ...validInput, agentId: "" }).success
      ).toBe(false);
    });

    it("rejects non-boolean enabled", () => {
      expect(
        SetRepoReviewConfigInputSchema.safeParse({ ...validInput, enabled: 1 }).success
      ).toBe(false);
    });
  });
});
