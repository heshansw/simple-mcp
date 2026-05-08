import { describe, it, expect } from "vitest";
import {
  AnalyzeFileInputSchema,
  AnalyzeDirectoryInputSchema,
  PreCommitCheckInputSchema,
  StartSessionInputSchema,
  SessionCheckInputSchema,
  EndSessionInputSchema,
  SnapshotInputSchema,
  TrendsInputSchema,
  HotspotsInputSchema,
  FunctionRankingInputSchema,
  DuplicationInputSchema,
  TypeCoverageInputSchema,
  AnalyzePrInputSchema,
  scoreToGrade,
  SupportedLanguageSchema,
  HealthGradeSchema,
} from "./code-health.schema.js";

// ── scoreToGrade ─────────────────────────────────────────────────────────

describe("scoreToGrade", () => {
  describe("grade A (>= 8.5)", () => {
    it("maps 10.0 to A", () => {
      expect(scoreToGrade(10.0)).toBe("A");
    });

    it("maps 8.5 (exact boundary) to A", () => {
      expect(scoreToGrade(8.5)).toBe("A");
    });

    it("maps 9.9 to A", () => {
      expect(scoreToGrade(9.9)).toBe("A");
    });
  });

  describe("grade B (>= 7.0 and < 8.5)", () => {
    it("maps 8.4 (just below A boundary) to B", () => {
      expect(scoreToGrade(8.4)).toBe("B");
    });

    it("maps 7.0 (exact boundary) to B", () => {
      expect(scoreToGrade(7.0)).toBe("B");
    });

    it("maps 7.5 to B", () => {
      expect(scoreToGrade(7.5)).toBe("B");
    });
  });

  describe("grade C (>= 5.0 and < 7.0)", () => {
    it("maps 6.99 (just below B boundary) to C", () => {
      expect(scoreToGrade(6.99)).toBe("C");
    });

    it("maps 5.0 (exact boundary) to C", () => {
      expect(scoreToGrade(5.0)).toBe("C");
    });

    it("maps 6.0 to C", () => {
      expect(scoreToGrade(6.0)).toBe("C");
    });
  });

  describe("grade D (>= 3.0 and < 5.0)", () => {
    it("maps 4.99 (just below C boundary) to D", () => {
      expect(scoreToGrade(4.99)).toBe("D");
    });

    it("maps 3.0 (exact boundary) to D", () => {
      expect(scoreToGrade(3.0)).toBe("D");
    });

    it("maps 4.0 to D", () => {
      expect(scoreToGrade(4.0)).toBe("D");
    });
  });

  describe("grade F (< 3.0)", () => {
    it("maps 2.99 (just below D boundary) to F", () => {
      expect(scoreToGrade(2.99)).toBe("F");
    });

    it("maps 1.0 to F", () => {
      expect(scoreToGrade(1.0)).toBe("F");
    });

    it("maps 0 to F", () => {
      expect(scoreToGrade(0)).toBe("F");
    });
  });
});

// ── SupportedLanguageSchema ───────────────────────────────────────────────

describe("SupportedLanguageSchema", () => {
  it("accepts 'typescript'", () => {
    expect(() => SupportedLanguageSchema.parse("typescript")).not.toThrow();
  });

  it("accepts 'javascript'", () => {
    expect(() => SupportedLanguageSchema.parse("javascript")).not.toThrow();
  });

  it("accepts 'java'", () => {
    expect(() => SupportedLanguageSchema.parse("java")).not.toThrow();
  });

  it("rejects 'python'", () => {
    expect(() => SupportedLanguageSchema.parse("python")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => SupportedLanguageSchema.parse("")).toThrow();
  });

  it("rejects null", () => {
    expect(() => SupportedLanguageSchema.parse(null)).toThrow();
  });

  it("rejects numeric 42", () => {
    expect(() => SupportedLanguageSchema.parse(42)).toThrow();
  });

  it("rejects 'TypeScript' (case-sensitive)", () => {
    expect(() => SupportedLanguageSchema.parse("TypeScript")).toThrow();
  });
});

// ── HealthGradeSchema ─────────────────────────────────────────────────────

describe("HealthGradeSchema", () => {
  it("accepts 'A'", () => {
    expect(() => HealthGradeSchema.parse("A")).not.toThrow();
  });

  it("accepts 'B'", () => {
    expect(() => HealthGradeSchema.parse("B")).not.toThrow();
  });

  it("accepts 'C'", () => {
    expect(() => HealthGradeSchema.parse("C")).not.toThrow();
  });

  it("accepts 'D'", () => {
    expect(() => HealthGradeSchema.parse("D")).not.toThrow();
  });

  it("accepts 'F'", () => {
    expect(() => HealthGradeSchema.parse("F")).not.toThrow();
  });

  it("rejects 'E' (not a valid grade)", () => {
    expect(() => HealthGradeSchema.parse("E")).toThrow();
  });

  it("rejects lowercase 'a'", () => {
    expect(() => HealthGradeSchema.parse("a")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => HealthGradeSchema.parse("")).toThrow();
  });

  it("rejects null", () => {
    expect(() => HealthGradeSchema.parse(null)).toThrow();
  });
});

// ── AnalyzeFileInputSchema ────────────────────────────────────────────────

describe("AnalyzeFileInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input with filePath", () => {
      const result = AnalyzeFileInputSchema.parse({ filePath: "/src/foo.ts" });
      expect(result.filePath).toBe("/src/foo.ts");
    });

    it("applies default includePerFunctionMetrics=true", () => {
      const result = AnalyzeFileInputSchema.parse({ filePath: "/src/foo.ts" });
      expect(result.includePerFunctionMetrics).toBe(true);
    });

    it("applies default includeSuggestions=true", () => {
      const result = AnalyzeFileInputSchema.parse({ filePath: "/src/foo.ts" });
      expect(result.includeSuggestions).toBe(true);
    });

    it("accepts explicit false values for optional booleans", () => {
      const result = AnalyzeFileInputSchema.parse({
        filePath: "/src/foo.ts",
        includePerFunctionMetrics: false,
        includeSuggestions: false,
      });
      expect(result.includePerFunctionMetrics).toBe(false);
      expect(result.includeSuggestions).toBe(false);
    });

    it("accepts deeply nested file paths", () => {
      expect(() =>
        AnalyzeFileInputSchema.parse({ filePath: "/a/b/c/d/e/file.java" }),
      ).not.toThrow();
    });
  });

  describe("rejection", () => {
    it("rejects empty filePath (min 1)", () => {
      expect(() => AnalyzeFileInputSchema.parse({ filePath: "" })).toThrow();
    });

    it("rejects missing filePath", () => {
      expect(() => AnalyzeFileInputSchema.parse({})).toThrow();
    });

    it("rejects numeric filePath", () => {
      expect(() => AnalyzeFileInputSchema.parse({ filePath: 42 })).toThrow();
    });

    it("rejects null filePath", () => {
      expect(() =>
        AnalyzeFileInputSchema.parse({ filePath: null }),
      ).toThrow();
    });
  });
});

// ── AnalyzeDirectoryInputSchema ───────────────────────────────────────────

describe("AnalyzeDirectoryInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input with directoryPath", () => {
      const result = AnalyzeDirectoryInputSchema.parse({
        directoryPath: "/src",
      });
      expect(result.directoryPath).toBe("/src");
    });

    it("defaults recursive to true", () => {
      const result = AnalyzeDirectoryInputSchema.parse({
        directoryPath: "/src",
      });
      expect(result.recursive).toBe(true);
    });

    it("defaults maxFiles to 200", () => {
      const result = AnalyzeDirectoryInputSchema.parse({
        directoryPath: "/src",
      });
      expect(result.maxFiles).toBe(200);
    });

    it("defaults extensions to include .ts, .tsx, .js, .jsx, .java", () => {
      const result = AnalyzeDirectoryInputSchema.parse({
        directoryPath: "/src",
      });
      expect(result.extensions).toContain(".ts");
      expect(result.extensions).toContain(".tsx");
      expect(result.extensions).toContain(".js");
      expect(result.extensions).toContain(".jsx");
      expect(result.extensions).toContain(".java");
    });

    it("defaults skipPatterns to include node_modules and dist", () => {
      const result = AnalyzeDirectoryInputSchema.parse({
        directoryPath: "/src",
      });
      expect(result.skipPatterns).toContain("node_modules");
      expect(result.skipPatterns).toContain("dist");
    });

    it("accepts full options override", () => {
      const result = AnalyzeDirectoryInputSchema.parse({
        directoryPath: "/src",
        recursive: false,
        extensions: [".ts"],
        maxFiles: 50,
        skipPatterns: ["__mocks__"],
      });
      expect(result.recursive).toBe(false);
      expect(result.maxFiles).toBe(50);
      expect(result.extensions).toEqual([".ts"]);
    });

    it("accepts optional workspaceId", () => {
      expect(() =>
        AnalyzeDirectoryInputSchema.parse({
          directoryPath: "/src",
          workspaceId: "ws-123",
        }),
      ).not.toThrow();
    });
  });

  describe("rejection", () => {
    it("rejects empty directoryPath", () => {
      expect(() =>
        AnalyzeDirectoryInputSchema.parse({ directoryPath: "" }),
      ).toThrow();
    });

    it("rejects missing directoryPath", () => {
      expect(() => AnalyzeDirectoryInputSchema.parse({})).toThrow();
    });

    it("rejects maxFiles of 0 (not positive)", () => {
      expect(() =>
        AnalyzeDirectoryInputSchema.parse({
          directoryPath: "/src",
          maxFiles: 0,
        }),
      ).toThrow();
    });

    it("rejects negative maxFiles", () => {
      expect(() =>
        AnalyzeDirectoryInputSchema.parse({
          directoryPath: "/src",
          maxFiles: -1,
        }),
      ).toThrow();
    });
  });
});

// ── PreCommitCheckInputSchema ─────────────────────────────────────────────

describe("PreCommitCheckInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal valid input", () => {
      const result = PreCommitCheckInputSchema.parse({
        directoryPath: "/src",
        filePaths: ["/src/a.ts"],
      });
      expect(result.filePaths).toHaveLength(1);
    });

    it("defaults maxAllowedRegression to 0.5", () => {
      const result = PreCommitCheckInputSchema.parse({
        directoryPath: "/src",
        filePaths: ["/src/a.ts"],
      });
      expect(result.maxAllowedRegression).toBe(0.5);
    });

    it("accepts multiple file paths", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({
          directoryPath: "/src",
          filePaths: ["/src/a.ts", "/src/b.ts", "/src/c.ts"],
        }),
      ).not.toThrow();
    });

    it("accepts optional requireMinScore", () => {
      const result = PreCommitCheckInputSchema.parse({
        directoryPath: "/src",
        filePaths: ["/src/a.ts"],
        requireMinScore: 7.0,
      });
      expect(result.requireMinScore).toBe(7.0);
    });

    it("accepts maxAllowedRegression of 0 (exact lower bound)", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({
          directoryPath: "/src",
          filePaths: ["/src/a.ts"],
          maxAllowedRegression: 0,
        }),
      ).not.toThrow();
    });

    it("accepts maxAllowedRegression of 10 (exact upper bound)", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({
          directoryPath: "/src",
          filePaths: ["/src/a.ts"],
          maxAllowedRegression: 10,
        }),
      ).not.toThrow();
    });
  });

  describe("rejection", () => {
    it("rejects empty filePaths array (min 1)", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({
          directoryPath: "/src",
          filePaths: [],
        }),
      ).toThrow();
    });

    it("rejects missing directoryPath", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({ filePaths: ["/src/a.ts"] }),
      ).toThrow();
    });

    it("rejects missing filePaths", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({ directoryPath: "/src" }),
      ).toThrow();
    });

    it("rejects maxAllowedRegression greater than 10", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({
          directoryPath: "/src",
          filePaths: ["/src/a.ts"],
          maxAllowedRegression: 11,
        }),
      ).toThrow();
    });

    it("rejects empty string inside filePaths array", () => {
      expect(() =>
        PreCommitCheckInputSchema.parse({
          directoryPath: "/src",
          filePaths: [""],
        }),
      ).toThrow();
    });
  });
});

// ── StartSessionInputSchema ───────────────────────────────────────────────

describe("StartSessionInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input with directoryPath only", () => {
      const result = StartSessionInputSchema.parse({
        directoryPath: "/src",
      });
      expect(result.directoryPath).toBe("/src");
    });

    it("defaults targetScore to 10", () => {
      const result = StartSessionInputSchema.parse({ directoryPath: "/src" });
      expect(result.targetScore).toBe(10);
    });

    it("defaults maxIterations to 5", () => {
      const result = StartSessionInputSchema.parse({ directoryPath: "/src" });
      expect(result.maxIterations).toBe(5);
    });

    it("filePaths is optional and absent by default", () => {
      const result = StartSessionInputSchema.parse({ directoryPath: "/src" });
      expect(result.filePaths).toBeUndefined();
    });

    it("accepts filePaths when provided", () => {
      const result = StartSessionInputSchema.parse({
        directoryPath: "/src",
        filePaths: ["/src/a.ts"],
      });
      expect(result.filePaths).toEqual(["/src/a.ts"]);
    });

    it("accepts targetScore override within range", () => {
      const result = StartSessionInputSchema.parse({
        directoryPath: "/src",
        targetScore: 7.5,
      });
      expect(result.targetScore).toBe(7.5);
    });

    it("accepts maxIterations override", () => {
      const result = StartSessionInputSchema.parse({
        directoryPath: "/src",
        maxIterations: 10,
      });
      expect(result.maxIterations).toBe(10);
    });
  });

  describe("rejection", () => {
    it("rejects empty directoryPath", () => {
      expect(() =>
        StartSessionInputSchema.parse({ directoryPath: "" }),
      ).toThrow();
    });

    it("rejects targetScore below 1", () => {
      expect(() =>
        StartSessionInputSchema.parse({ directoryPath: "/src", targetScore: 0 }),
      ).toThrow();
    });

    it("rejects targetScore above 10", () => {
      expect(() =>
        StartSessionInputSchema.parse({
          directoryPath: "/src",
          targetScore: 11,
        }),
      ).toThrow();
    });

    it("rejects maxIterations of 0 (not positive)", () => {
      expect(() =>
        StartSessionInputSchema.parse({
          directoryPath: "/src",
          maxIterations: 0,
        }),
      ).toThrow();
    });
  });
});

// ── SessionCheckInputSchema ───────────────────────────────────────────────

describe("SessionCheckInputSchema", () => {
  it("accepts valid sessionId", () => {
    expect(() =>
      SessionCheckInputSchema.parse({ sessionId: "abc-123" }),
    ).not.toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() =>
      SessionCheckInputSchema.parse({ sessionId: "" }),
    ).toThrow();
  });

  it("rejects missing sessionId", () => {
    expect(() => SessionCheckInputSchema.parse({})).toThrow();
  });
});

// ── EndSessionInputSchema ─────────────────────────────────────────────────

describe("EndSessionInputSchema", () => {
  it("accepts valid sessionId", () => {
    expect(() =>
      EndSessionInputSchema.parse({ sessionId: "session-xyz" }),
    ).not.toThrow();
  });

  it("rejects empty sessionId", () => {
    expect(() =>
      EndSessionInputSchema.parse({ sessionId: "" }),
    ).toThrow();
  });

  it("rejects missing sessionId", () => {
    expect(() => EndSessionInputSchema.parse({})).toThrow();
  });
});

// ── SnapshotInputSchema ───────────────────────────────────────────────────

describe("SnapshotInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input with directoryPath", () => {
      expect(() =>
        SnapshotInputSchema.parse({ directoryPath: "/src" }),
      ).not.toThrow();
    });

    it("defaults extensions to standard set", () => {
      const result = SnapshotInputSchema.parse({ directoryPath: "/src" });
      expect(result.extensions).toContain(".ts");
      expect(result.extensions).toContain(".java");
    });

    it("defaults skipPatterns to include node_modules", () => {
      const result = SnapshotInputSchema.parse({ directoryPath: "/src" });
      expect(result.skipPatterns).toContain("node_modules");
    });

    it("accepts optional label", () => {
      const result = SnapshotInputSchema.parse({
        directoryPath: "/src",
        label: "v1.2.0",
      });
      expect(result.label).toBe("v1.2.0");
    });

    it("accepts optional workspaceId", () => {
      expect(() =>
        SnapshotInputSchema.parse({ directoryPath: "/src", workspaceId: "ws-1" }),
      ).not.toThrow();
    });
  });

  describe("rejection", () => {
    it("rejects empty directoryPath", () => {
      expect(() =>
        SnapshotInputSchema.parse({ directoryPath: "" }),
      ).toThrow();
    });

    it("rejects missing directoryPath", () => {
      expect(() => SnapshotInputSchema.parse({})).toThrow();
    });
  });
});

// ── TrendsInputSchema ─────────────────────────────────────────────────────

describe("TrendsInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input with targetPath", () => {
      expect(() =>
        TrendsInputSchema.parse({ targetPath: "/src" }),
      ).not.toThrow();
    });

    it("defaults scope to 'directory'", () => {
      const result = TrendsInputSchema.parse({ targetPath: "/src" });
      expect(result.scope).toBe("directory");
    });

    it("defaults period to '30d'", () => {
      const result = TrendsInputSchema.parse({ targetPath: "/src" });
      expect(result.period).toBe("30d");
    });

    it("defaults granularity to 'weekly'", () => {
      const result = TrendsInputSchema.parse({ targetPath: "/src" });
      expect(result.granularity).toBe("weekly");
    });

    it("accepts scope='file'", () => {
      const result = TrendsInputSchema.parse({
        targetPath: "/src/foo.ts",
        scope: "file",
      });
      expect(result.scope).toBe("file");
    });

    it("accepts all valid period values", () => {
      for (const period of ["7d", "30d", "90d", "all"] as const) {
        expect(() =>
          TrendsInputSchema.parse({ targetPath: "/src", period }),
        ).not.toThrow();
      }
    });

    it("accepts all valid granularity values", () => {
      for (const granularity of ["daily", "weekly", "monthly"] as const) {
        expect(() =>
          TrendsInputSchema.parse({ targetPath: "/src", granularity }),
        ).not.toThrow();
      }
    });
  });

  describe("rejection", () => {
    it("rejects empty targetPath", () => {
      expect(() => TrendsInputSchema.parse({ targetPath: "" })).toThrow();
    });

    it("rejects invalid period value", () => {
      expect(() =>
        TrendsInputSchema.parse({ targetPath: "/src", period: "60d" }),
      ).toThrow();
    });

    it("rejects invalid granularity value", () => {
      expect(() =>
        TrendsInputSchema.parse({ targetPath: "/src", granularity: "hourly" }),
      ).toThrow();
    });

    it("rejects invalid scope value", () => {
      expect(() =>
        TrendsInputSchema.parse({ targetPath: "/src", scope: "workspace" }),
      ).toThrow();
    });

    it("rejects missing targetPath", () => {
      expect(() => TrendsInputSchema.parse({})).toThrow();
    });
  });
});

// ── HotspotsInputSchema ───────────────────────────────────────────────────

describe("HotspotsInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input", () => {
      expect(() =>
        HotspotsInputSchema.parse({ directoryPath: "/src" }),
      ).not.toThrow();
    });

    it("defaults lookbackDays to 90", () => {
      const result = HotspotsInputSchema.parse({ directoryPath: "/src" });
      expect(result.lookbackDays).toBe(90);
    });

    it("defaults topN to 20", () => {
      const result = HotspotsInputSchema.parse({ directoryPath: "/src" });
      expect(result.topN).toBe(20);
    });

    it("accepts optional gitBranch", () => {
      expect(() =>
        HotspotsInputSchema.parse({
          directoryPath: "/src",
          gitBranch: "main",
        }),
      ).not.toThrow();
    });
  });

  describe("rejection", () => {
    it("rejects empty directoryPath", () => {
      expect(() =>
        HotspotsInputSchema.parse({ directoryPath: "" }),
      ).toThrow();
    });

    it("rejects missing directoryPath", () => {
      expect(() => HotspotsInputSchema.parse({})).toThrow();
    });

    it("rejects lookbackDays of 0", () => {
      expect(() =>
        HotspotsInputSchema.parse({ directoryPath: "/src", lookbackDays: 0 }),
      ).toThrow();
    });

    it("rejects topN of 0", () => {
      expect(() =>
        HotspotsInputSchema.parse({ directoryPath: "/src", topN: 0 }),
      ).toThrow();
    });
  });
});

// ── FunctionRankingInputSchema ────────────────────────────────────────────

describe("FunctionRankingInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input", () => {
      expect(() =>
        FunctionRankingInputSchema.parse({ targetPath: "/src" }),
      ).not.toThrow();
    });

    it("defaults sortBy to 'cognitive'", () => {
      const result = FunctionRankingInputSchema.parse({ targetPath: "/src" });
      expect(result.sortBy).toBe("cognitive");
    });

    it("defaults limit to 50", () => {
      const result = FunctionRankingInputSchema.parse({ targetPath: "/src" });
      expect(result.limit).toBe(50);
    });

    it("accepts all valid sortBy values", () => {
      const validValues = [
        "cyclomatic",
        "cognitive",
        "halstead_effort",
        "loc",
        "parameter_count",
      ] as const;
      for (const sortBy of validValues) {
        expect(() =>
          FunctionRankingInputSchema.parse({ targetPath: "/src", sortBy }),
        ).not.toThrow();
      }
    });

    it("accepts optional minThreshold", () => {
      const result = FunctionRankingInputSchema.parse({
        targetPath: "/src",
        minThreshold: 15,
      });
      expect(result.minThreshold).toBe(15);
    });
  });

  describe("rejection", () => {
    it("rejects empty targetPath", () => {
      expect(() =>
        FunctionRankingInputSchema.parse({ targetPath: "" }),
      ).toThrow();
    });

    it("rejects missing targetPath", () => {
      expect(() => FunctionRankingInputSchema.parse({})).toThrow();
    });

    it("rejects invalid sortBy value", () => {
      expect(() =>
        FunctionRankingInputSchema.parse({ targetPath: "/src", sortBy: "lines" }),
      ).toThrow();
    });

    it("rejects limit of 0", () => {
      expect(() =>
        FunctionRankingInputSchema.parse({ targetPath: "/src", limit: 0 }),
      ).toThrow();
    });
  });
});

// ── DuplicationInputSchema ────────────────────────────────────────────────

describe("DuplicationInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input", () => {
      expect(() =>
        DuplicationInputSchema.parse({ directoryPath: "/src" }),
      ).not.toThrow();
    });

    it("defaults minTokens to 50", () => {
      const result = DuplicationInputSchema.parse({ directoryPath: "/src" });
      expect(result.minTokens).toBe(50);
    });

    it("defaults minLines to 6", () => {
      const result = DuplicationInputSchema.parse({ directoryPath: "/src" });
      expect(result.minLines).toBe(6);
    });

    it("defaults extensions to standard set", () => {
      const result = DuplicationInputSchema.parse({ directoryPath: "/src" });
      expect(result.extensions).toContain(".ts");
      expect(result.extensions).toContain(".java");
    });

    it("accepts custom extensions override", () => {
      const result = DuplicationInputSchema.parse({
        directoryPath: "/src",
        extensions: [".ts", ".tsx"],
      });
      expect(result.extensions).toEqual([".ts", ".tsx"]);
    });
  });

  describe("rejection", () => {
    it("rejects empty directoryPath", () => {
      expect(() =>
        DuplicationInputSchema.parse({ directoryPath: "" }),
      ).toThrow();
    });

    it("rejects missing directoryPath", () => {
      expect(() => DuplicationInputSchema.parse({})).toThrow();
    });

    it("rejects minTokens of 0", () => {
      expect(() =>
        DuplicationInputSchema.parse({ directoryPath: "/src", minTokens: 0 }),
      ).toThrow();
    });

    it("rejects minLines of 0", () => {
      expect(() =>
        DuplicationInputSchema.parse({ directoryPath: "/src", minLines: 0 }),
      ).toThrow();
    });
  });
});

// ── TypeCoverageInputSchema ───────────────────────────────────────────────

describe("TypeCoverageInputSchema", () => {
  describe("acceptance", () => {
    it("accepts minimal input with targetPath", () => {
      expect(() =>
        TypeCoverageInputSchema.parse({ targetPath: "/src/foo.ts" }),
      ).not.toThrow();
    });

    it("accepts optional tsconfigPath", () => {
      const result = TypeCoverageInputSchema.parse({
        targetPath: "/src/foo.ts",
        tsconfigPath: "/tsconfig.json",
      });
      expect(result.tsconfigPath).toBe("/tsconfig.json");
    });

    it("tsconfigPath is absent by default", () => {
      const result = TypeCoverageInputSchema.parse({ targetPath: "/src" });
      expect(result.tsconfigPath).toBeUndefined();
    });
  });

  describe("rejection", () => {
    it("rejects empty targetPath", () => {
      expect(() =>
        TypeCoverageInputSchema.parse({ targetPath: "" }),
      ).toThrow();
    });

    it("rejects missing targetPath", () => {
      expect(() => TypeCoverageInputSchema.parse({})).toThrow();
    });
  });
});

// ── AnalyzePrInputSchema ──────────────────────────────────────────────────

describe("AnalyzePrInputSchema", () => {
  const validPrInput = { owner: "org", repo: "app", prNumber: 42 };

  describe("acceptance", () => {
    it("accepts minimal valid input", () => {
      expect(() => AnalyzePrInputSchema.parse(validPrInput)).not.toThrow();
    });

    it("defaults failOnRegression to false", () => {
      const result = AnalyzePrInputSchema.parse(validPrInput);
      expect(result.failOnRegression).toBe(false);
    });

    it("defaults regressionThreshold to 0.5", () => {
      const result = AnalyzePrInputSchema.parse(validPrInput);
      expect(result.regressionThreshold).toBe(0.5);
    });

    it("accepts explicit failOnRegression=true", () => {
      const result = AnalyzePrInputSchema.parse({
        ...validPrInput,
        failOnRegression: true,
      });
      expect(result.failOnRegression).toBe(true);
    });

    it("accepts regressionThreshold at upper bound (10)", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ ...validPrInput, regressionThreshold: 10 }),
      ).not.toThrow();
    });

    it("accepts regressionThreshold at lower bound (0)", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ ...validPrInput, regressionThreshold: 0 }),
      ).not.toThrow();
    });
  });

  describe("rejection", () => {
    it("rejects prNumber of 0 (not positive integer)", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ ...validPrInput, prNumber: 0 }),
      ).toThrow();
    });

    it("rejects negative prNumber", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ ...validPrInput, prNumber: -1 }),
      ).toThrow();
    });

    it("rejects missing owner", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ repo: "app", prNumber: 42 }),
      ).toThrow();
    });

    it("rejects empty owner", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ owner: "", repo: "app", prNumber: 42 }),
      ).toThrow();
    });

    it("rejects missing repo", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ owner: "org", prNumber: 42 }),
      ).toThrow();
    });

    it("rejects regressionThreshold above 10", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({
          ...validPrInput,
          regressionThreshold: 10.1,
        }),
      ).toThrow();
    });

    it("rejects non-integer prNumber", () => {
      expect(() =>
        AnalyzePrInputSchema.parse({ ...validPrInput, prNumber: 1.5 }),
      ).toThrow();
    });
  });
});
