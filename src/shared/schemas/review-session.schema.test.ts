import { describe, it, expect } from "vitest";
import {
  ReviewSessionStatusSchema,
  ReviewVerdictSchema,
  CommentCategorySchema,
  DraftCommentSchema,
  StoreAgentReviewDraftInputSchema,
  StartPrReviewSessionInputSchema,
  PublishConsolidatedReviewInputSchema,
  ConsolidatedCommentSchema,
  GetReviewSessionDraftsInputSchema,
} from "./review-session.schema.js";

// ---------------------------------------------------------------------------
// ReviewSessionStatusSchema
// ---------------------------------------------------------------------------

describe("ReviewSessionStatusSchema", () => {
  const validStatuses = ["pending", "reviewing", "synthesising", "completed", "failed"] as const;

  it.each(validStatuses)('accepts "%s"', (status) => {
    expect(ReviewSessionStatusSchema.safeParse(status).success).toBe(true);
  });

  it("rejects unknown status", () => {
    expect(ReviewSessionStatusSchema.safeParse("cancelled").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(ReviewSessionStatusSchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReviewVerdictSchema
// ---------------------------------------------------------------------------

describe("ReviewVerdictSchema", () => {
  const validVerdicts = ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const;

  it.each(validVerdicts)('accepts "%s"', (verdict) => {
    expect(ReviewVerdictSchema.safeParse(verdict).success).toBe(true);
  });

  it("rejects lowercase variant", () => {
    expect(ReviewVerdictSchema.safeParse("approve").success).toBe(false);
  });

  it("rejects unknown verdict", () => {
    expect(ReviewVerdictSchema.safeParse("REJECT").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CommentCategorySchema
// ---------------------------------------------------------------------------

describe("CommentCategorySchema", () => {
  const validCategories = [
    "bug",
    "security",
    "performance",
    "style",
    "test",
    "docs",
    "other",
  ] as const;

  it.each(validCategories)('accepts "%s"', (category) => {
    expect(CommentCategorySchema.safeParse(category).success).toBe(true);
  });

  it("rejects unknown category", () => {
    expect(CommentCategorySchema.safeParse("nitpick").success).toBe(false);
  });

  it("rejects empty string", () => {
    expect(CommentCategorySchema.safeParse("").success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DraftCommentSchema
// ---------------------------------------------------------------------------

describe("DraftCommentSchema", () => {
  const validComment = {
    path: "src/index.ts",
    position: 5,
    body: "Consider using const here",
    category: "style",
  };

  describe("acceptance", () => {
    it("accepts valid comment", () => {
      expect(DraftCommentSchema.safeParse(validComment).success).toBe(true);
    });

    it("accepts all valid categories", () => {
      for (const category of ["bug", "security", "performance", "style", "test", "docs", "other"]) {
        expect(DraftCommentSchema.safeParse({ ...validComment, category }).success).toBe(true);
      }
    });

    it("accepts position of 1 (minimum positive integer)", () => {
      expect(DraftCommentSchema.safeParse({ ...validComment, position: 1 }).success).toBe(true);
    });
  });

  describe("rejection", () => {
    it("rejects position 0 (not positive)", () => {
      expect(DraftCommentSchema.safeParse({ ...validComment, position: 0 }).success).toBe(false);
    });

    it("rejects negative position", () => {
      expect(DraftCommentSchema.safeParse({ ...validComment, position: -1 }).success).toBe(false);
    });

    it("rejects float position", () => {
      expect(DraftCommentSchema.safeParse({ ...validComment, position: 1.5 }).success).toBe(false);
    });

    it("rejects invalid category", () => {
      expect(
        DraftCommentSchema.safeParse({ ...validComment, category: "nitpick" }).success
      ).toBe(false);
    });

    it("rejects empty path", () => {
      expect(DraftCommentSchema.safeParse({ ...validComment, path: "" }).success).toBe(false);
    });

    it("rejects empty body", () => {
      expect(DraftCommentSchema.safeParse({ ...validComment, body: "" }).success).toBe(false);
    });

    it("rejects missing path", () => {
      const { path: _p, ...rest } = validComment;
      expect(DraftCommentSchema.safeParse(rest).success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// StoreAgentReviewDraftInputSchema
// ---------------------------------------------------------------------------

describe("StoreAgentReviewDraftInputSchema", () => {
  const validDraft = {
    sessionId: "session-abc",
    agentId: "backend-pr-reviewer",
    aiTool: "claude",
    verdict: "APPROVE",
    body: "Looks good to me",
    comments: [
      {
        path: "src/foo.ts",
        position: 3,
        body: "Minor style issue",
        category: "style",
      },
    ],
  };

  describe("acceptance", () => {
    it("accepts valid draft with comments", () => {
      expect(StoreAgentReviewDraftInputSchema.safeParse(validDraft).success).toBe(true);
    });

    it("accepts draft with empty comments array", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, comments: [] }).success
      ).toBe(true);
    });

    it("defaults comments to empty array when omitted", () => {
      const { comments: _c, ...rest } = validDraft;
      const result = StoreAgentReviewDraftInputSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.comments).toEqual([]);
      }
    });

    it("accepts runId as null", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, runId: null }).success
      ).toBe(true);
    });

    it("accepts runId as a string", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, runId: "run-xyz" }).success
      ).toBe(true);
    });

    it("accepts all three verdicts", () => {
      for (const verdict of ["APPROVE", "REQUEST_CHANGES", "COMMENT"]) {
        expect(
          StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, verdict }).success
        ).toBe(true);
      }
    });
  });

  describe("rejection", () => {
    it("rejects missing sessionId", () => {
      const { sessionId: _s, ...rest } = validDraft;
      expect(StoreAgentReviewDraftInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects empty sessionId", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, sessionId: "" }).success
      ).toBe(false);
    });

    it("rejects missing verdict", () => {
      const { verdict: _v, ...rest } = validDraft;
      expect(StoreAgentReviewDraftInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects invalid verdict", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, verdict: "REJECT" }).success
      ).toBe(false);
    });

    it("rejects missing body", () => {
      const { body: _b, ...rest } = validDraft;
      expect(StoreAgentReviewDraftInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects empty body", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({ ...validDraft, body: "" }).success
      ).toBe(false);
    });

    it("rejects invalid comment in array", () => {
      expect(
        StoreAgentReviewDraftInputSchema.safeParse({
          ...validDraft,
          comments: [{ path: "src/foo.ts", position: 0, body: "bad position", category: "bug" }],
        }).success
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// StartPrReviewSessionInputSchema
// ---------------------------------------------------------------------------

describe("StartPrReviewSessionInputSchema", () => {
  const validInput = {
    owner: "octocat",
    repo: "hello-world",
    prNumber: 42,
  };

  describe("acceptance", () => {
    it("accepts valid input", () => {
      expect(StartPrReviewSessionInputSchema.safeParse(validInput).success).toBe(true);
    });

    it("accepts prNumber of 1 (minimum positive)", () => {
      expect(
        StartPrReviewSessionInputSchema.safeParse({ ...validInput, prNumber: 1 }).success
      ).toBe(true);
    });
  });

  describe("rejection", () => {
    it("rejects negative prNumber", () => {
      expect(
        StartPrReviewSessionInputSchema.safeParse({ ...validInput, prNumber: -1 }).success
      ).toBe(false);
    });

    it("rejects prNumber of 0", () => {
      expect(
        StartPrReviewSessionInputSchema.safeParse({ ...validInput, prNumber: 0 }).success
      ).toBe(false);
    });

    it("rejects non-integer prNumber", () => {
      expect(
        StartPrReviewSessionInputSchema.safeParse({ ...validInput, prNumber: 1.5 }).success
      ).toBe(false);
    });

    it("rejects missing owner", () => {
      const { owner: _o, ...rest } = validInput;
      expect(StartPrReviewSessionInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects empty owner", () => {
      expect(
        StartPrReviewSessionInputSchema.safeParse({ ...validInput, owner: "" }).success
      ).toBe(false);
    });

    it("rejects missing repo", () => {
      const { repo: _r, ...rest } = validInput;
      expect(StartPrReviewSessionInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects empty repo", () => {
      expect(
        StartPrReviewSessionInputSchema.safeParse({ ...validInput, repo: "" }).success
      ).toBe(false);
    });

    it("rejects missing prNumber", () => {
      const { prNumber: _p, ...rest } = validInput;
      expect(StartPrReviewSessionInputSchema.safeParse(rest).success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ConsolidatedCommentSchema
// ---------------------------------------------------------------------------

describe("ConsolidatedCommentSchema", () => {
  const validComment = {
    path: "src/server.ts",
    position: 10,
    body: "Attribution footer included **[agent — claude]**",
  };

  describe("acceptance", () => {
    it("accepts valid consolidated comment", () => {
      expect(ConsolidatedCommentSchema.safeParse(validComment).success).toBe(true);
    });

    it("accepts position of 1 (minimum positive)", () => {
      expect(ConsolidatedCommentSchema.safeParse({ ...validComment, position: 1 }).success).toBe(
        true
      );
    });
  });

  describe("rejection", () => {
    it("rejects position 0", () => {
      expect(ConsolidatedCommentSchema.safeParse({ ...validComment, position: 0 }).success).toBe(
        false
      );
    });

    it("rejects negative position", () => {
      expect(ConsolidatedCommentSchema.safeParse({ ...validComment, position: -5 }).success).toBe(
        false
      );
    });

    it("rejects empty path", () => {
      expect(ConsolidatedCommentSchema.safeParse({ ...validComment, path: "" }).success).toBe(
        false
      );
    });

    it("rejects empty body", () => {
      expect(ConsolidatedCommentSchema.safeParse({ ...validComment, body: "" }).success).toBe(
        false
      );
    });
  });
});

// ---------------------------------------------------------------------------
// PublishConsolidatedReviewInputSchema
// ---------------------------------------------------------------------------

describe("PublishConsolidatedReviewInputSchema", () => {
  const validInput = {
    sessionId: "session-abc",
    owner: "octocat",
    repo: "hello-world",
    prNumber: 42,
    verdict: "REQUEST_CHANGES",
    body: "> This review was produced by multiple AI agents: claude, gemini.\n\nFindings below.",
    comments: [
      {
        path: "src/index.ts",
        position: 5,
        body: "Bug here **[agent — claude]**",
      },
    ],
  };

  describe("acceptance", () => {
    it("accepts valid input with comments", () => {
      expect(PublishConsolidatedReviewInputSchema.safeParse(validInput).success).toBe(true);
    });

    it("accepts empty comments array", () => {
      expect(
        PublishConsolidatedReviewInputSchema.safeParse({ ...validInput, comments: [] }).success
      ).toBe(true);
    });

    it("defaults comments to empty array when omitted", () => {
      const { comments: _c, ...rest } = validInput;
      const result = PublishConsolidatedReviewInputSchema.safeParse(rest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.comments).toEqual([]);
      }
    });

    it("accepts all three verdicts", () => {
      for (const verdict of ["APPROVE", "REQUEST_CHANGES", "COMMENT"]) {
        expect(
          PublishConsolidatedReviewInputSchema.safeParse({ ...validInput, verdict }).success
        ).toBe(true);
      }
    });
  });

  describe("rejection", () => {
    it("rejects comment with position <= 0", () => {
      expect(
        PublishConsolidatedReviewInputSchema.safeParse({
          ...validInput,
          comments: [{ path: "src/foo.ts", position: 0, body: "bad" }],
        }).success
      ).toBe(false);
    });

    it("rejects missing sessionId", () => {
      const { sessionId: _s, ...rest } = validInput;
      expect(PublishConsolidatedReviewInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects missing prNumber", () => {
      const { prNumber: _p, ...rest } = validInput;
      expect(PublishConsolidatedReviewInputSchema.safeParse(rest).success).toBe(false);
    });

    it("rejects negative prNumber", () => {
      expect(
        PublishConsolidatedReviewInputSchema.safeParse({ ...validInput, prNumber: -1 }).success
      ).toBe(false);
    });

    it("rejects empty body", () => {
      expect(
        PublishConsolidatedReviewInputSchema.safeParse({ ...validInput, body: "" }).success
      ).toBe(false);
    });

    it("rejects invalid verdict", () => {
      expect(
        PublishConsolidatedReviewInputSchema.safeParse({ ...validInput, verdict: "DENY" }).success
      ).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// GetReviewSessionDraftsInputSchema
// ---------------------------------------------------------------------------

describe("GetReviewSessionDraftsInputSchema", () => {
  it("accepts valid sessionId", () => {
    expect(GetReviewSessionDraftsInputSchema.safeParse({ sessionId: "session-xyz" }).success).toBe(
      true
    );
  });

  it("rejects empty sessionId", () => {
    expect(GetReviewSessionDraftsInputSchema.safeParse({ sessionId: "" }).success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    expect(GetReviewSessionDraftsInputSchema.safeParse({}).success).toBe(false);
  });
});
