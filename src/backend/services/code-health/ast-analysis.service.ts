import { readFile } from "node:fs/promises";
import { extname } from "node:path";

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error — typhonjs-escomplex has no type declarations
import escomplex from "typhonjs-escomplex";
import { parse } from "java-parser";

import type { Result } from "@shared/result.js";
import { ok, err, validationError, integrationError } from "@shared/result.js";
import type { DomainError } from "@shared/result.js";
import type {
  FileAstMetrics,
  FunctionMetrics,
  HalsteadMetrics,
  SupportedLanguage,
} from "@shared/schemas/code-health.schema.js";
import { SUPPORTED_EXTENSIONS } from "@shared/schemas/code-health.schema.js";

import { computeNestingDepths } from "./ts-nesting.service.js";
import { computeJavaCognitiveComplexity } from "./java-cognitive-complexity.service.js";
import { analyzeCodeSmells } from "./code-smells.service.js";

// ── cognitive-complexity-ts dynamic import ────────────────────────────

type CognitiveComplexityFn = (
  source: string,
  fileName: string,
) => { inner: Array<{ name: string; score: number; line: number }> };

let getCognitiveComplexity: CognitiveComplexityFn | null = null;

try {
  const mod = await import("cognitive-complexity-ts");
  getCognitiveComplexity =
    (mod.getSourceOutput as CognitiveComplexityFn | undefined) ??
    (mod.default?.getSourceOutput as CognitiveComplexityFn | undefined) ??
    null;
} catch {
  // Package not available, fall back to cyclomatic-based approximation
}

// ── Types ──────────────────────────────────────────────────────────────

export type AstAnalysisDeps = {
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export type AstAnalysisService = {
  analyzeFile(filePath: string): Promise<Result<FileAstMetrics, DomainError>>;
  analyzeFiles(
    filePaths: ReadonlyArray<string>,
  ): Promise<Result<ReadonlyArray<FileAstMetrics>, DomainError>>;
  detectLanguage(filePath: string): SupportedLanguage | null;
};

// ── Constants ──────────────────────────────────────────────────────────

const ESCOMPLEX_OPTIONS = {
  commonjs: true,
  logicalor: true,
  switchcase: true,
} as const;

const DEFAULT_HALSTEAD: HalsteadMetrics = {
  effort: 0,
  difficulty: 0,
  volume: 0,
  vocabulary: 0,
  length: 0,
  bugs: 0,
};

// ── Java CST Walking Helpers ───────────────────────────────────────────

type CstNode = {
  name?: string;
  children?: Record<string, ReadonlyArray<CstNode | CstToken>>;
  location?: { startLine?: number; endLine?: number };
};

type CstToken = {
  image?: string;
  startLine?: number;
  endLine?: number;
};

function isCstNode(value: CstNode | CstToken): value is CstNode {
  return "children" in value && value.children !== undefined;
}

function collectNodes(
  node: CstNode,
  targetName: string,
  results: CstNode[],
): void {
  if (node.name === targetName) {
    results.push(node);
  }
  if (node.children) {
    for (const childArray of Object.values(node.children)) {
      for (const child of childArray) {
        if (isCstNode(child)) {
          collectNodes(child, targetName, results);
        }
      }
    }
  }
}

function countTokenImages(
  node: CstNode,
  targets: ReadonlyArray<string>,
): number {
  let count = 0;
  if (node.children) {
    for (const childArray of Object.values(node.children)) {
      for (const child of childArray) {
        if (isCstNode(child)) {
          count += countTokenImages(child, targets);
        } else if (child.image !== undefined && targets.includes(child.image)) {
          count += 1;
        }
      }
    }
  }
  return count;
}

function getNodeLineRange(node: CstNode): { startLine: number; endLine: number } {
  let minLine = Number.MAX_SAFE_INTEGER;
  let maxLine = 0;

  function walk(n: CstNode | CstToken): void {
    if (!isCstNode(n)) {
      if (n.startLine !== undefined && n.startLine < minLine) minLine = n.startLine;
      if (n.endLine !== undefined && n.endLine > maxLine) maxLine = n.endLine;
      return;
    }
    if (n.location) {
      if (n.location.startLine !== undefined && n.location.startLine < minLine) {
        minLine = n.location.startLine;
      }
      if (n.location.endLine !== undefined && n.location.endLine > maxLine) {
        maxLine = n.location.endLine;
      }
    }
    if (n.children) {
      for (const childArray of Object.values(n.children)) {
        for (const child of childArray) {
          walk(child);
        }
      }
    }
  }

  walk(node);
  return {
    startLine: minLine === Number.MAX_SAFE_INTEGER ? 1 : minLine,
    endLine: maxLine === 0 ? 1 : maxLine,
  };
}

function estimateMaxNestingDepth(node: CstNode): number {
  const nestingKeywords = [
    "ifStatement",
    "forStatement",
    "whileStatement",
    "doWhileStatement",
    "switchStatement",
    "tryStatement",
    "lambdaExpression",
  ];

  function walk(n: CstNode, depth: number): number {
    let maxDepth = depth;
    if (n.children) {
      for (const [key, childArray] of Object.entries(n.children)) {
        for (const child of childArray) {
          if (isCstNode(child)) {
            const nextDepth = nestingKeywords.includes(key) ? depth + 1 : depth;
            const childMax = walk(child, nextDepth);
            if (childMax > maxDepth) maxDepth = childMax;
          }
        }
      }
    }
    return maxDepth;
  }

  return walk(node, 0);
}

const JAVA_COMPLEXITY_TOKENS = [
  "if",
  "for",
  "while",
  "switch",
  "case",
  "catch",
  "&&",
  "||",
] as const;

function getMethodName(methodNode: CstNode): string {
  if (!methodNode.children) return "<anonymous>";

  // Constructor: look for the class name via constructorDeclarator > simpleTypeName > Identifier
  const constructorDeclarators = methodNode.children["constructorDeclarator"] as
    | ReadonlyArray<CstNode>
    | undefined;
  if (constructorDeclarators) {
    for (const declarator of constructorDeclarators) {
      if (isCstNode(declarator) && declarator.children) {
        const typeNames = declarator.children["simpleTypeName"] as
          | ReadonlyArray<CstNode>
          | undefined;
        if (typeNames) {
          for (const typeName of typeNames) {
            if (isCstNode(typeName) && typeName.children) {
              const ids = typeName.children["Identifier"] as
                | ReadonlyArray<CstToken>
                | undefined;
              const firstId = ids?.[0];
              if (firstId?.image) {
                return `<constructor:${firstId.image}>`;
              }
            }
          }
        }
        // Fallback: try direct Identifier on constructorDeclarator
        const ids = declarator.children["Identifier"] as
          | ReadonlyArray<CstToken>
          | undefined;
        const firstId = ids?.[0];
        if (firstId?.image) {
          return `<constructor:${firstId.image}>`;
        }
      }
    }
  }

  // Regular method: methodDeclarator > Identifier
  const methodDeclarators = methodNode.children["methodDeclarator"] as
    | ReadonlyArray<CstNode>
    | undefined;
  if (methodDeclarators) {
    for (const declarator of methodDeclarators) {
      if (isCstNode(declarator) && declarator.children) {
        const ids = declarator.children["Identifier"] as
          | ReadonlyArray<CstToken>
          | undefined;
        const firstId = ids?.[0];
        if (firstId?.image) {
          return firstId.image;
        }
      }
    }
  }

  // Interface method: interfaceMethodDeclaration wraps a methodHeader > methodDeclarator
  const methodHeaders = methodNode.children["methodHeader"] as
    | ReadonlyArray<CstNode>
    | undefined;
  if (methodHeaders) {
    for (const header of methodHeaders) {
      if (isCstNode(header) && header.children) {
        const innerDeclarators = header.children["methodDeclarator"] as
          | ReadonlyArray<CstNode>
          | undefined;
        if (innerDeclarators) {
          for (const declarator of innerDeclarators) {
            if (isCstNode(declarator) && declarator.children) {
              const ids = declarator.children["Identifier"] as
                | ReadonlyArray<CstToken>
                | undefined;
              const firstId = ids?.[0];
              if (firstId?.image) {
                return firstId.image;
              }
            }
          }
        }
      }
    }
  }

  // Lambda/anonymous fallback: use line number
  const { startLine } = getNodeLineRange(methodNode);
  return `lambda@${startLine}`;
}

function countMethodParameters(methodNode: CstNode): number {
  const declarators: CstNode[] = [];
  collectNodes(methodNode, "formalParameter", declarators);
  return declarators.length;
}

// ── Java File Analysis ─────────────────────────────────────────────────

function analyzeJavaFile(
  filePath: string,
  source: string,
): FileAstMetrics {
  const cst = parse(source) as CstNode;
  const lines = source.split("\n");
  const totalLoc = lines.length;

  const nonEmptyLines = lines.filter(
    (line) => line.trim().length > 0 && !line.trim().startsWith("//"),
  );
  const slocLogical = nonEmptyLines.length;

  const methodNodes: CstNode[] = [];
  collectNodes(cst, "methodDeclaration", methodNodes);
  collectNodes(cst, "constructorDeclaration", methodNodes);

  const functions: FunctionMetrics[] = methodNodes.map((methodNode) => {
    const name = getMethodName(methodNode);
    const { startLine, endLine } = getNodeLineRange(methodNode);
    const loc = Math.max(1, endLine - startLine + 1);
    const paramCount = countMethodParameters(methodNode);
    const cyclomatic = 1 + countTokenImages(methodNode, JAVA_COMPLEXITY_TOKENS);
    const nestingDepth = estimateMaxNestingDepth(methodNode);

    return {
      name,
      startLine,
      endLine,
      loc,
      parameterCount: paramCount,
      cyclomatic,
      cognitive: cyclomatic, // Placeholder; overwritten below with real cognitive complexity
      halstead: { ...DEFAULT_HALSTEAD },
      nestingDepth,
    };
  });

  // Compute real cognitive complexity for Java methods
  if (functions.length > 0) {
    const cognitiveResults = computeJavaCognitiveComplexity(
      source,
      functions.map((f) => ({ startLine: f.startLine, endLine: f.endLine })),
    );
    for (let i = 0; i < functions.length; i++) {
      const cogResult = cognitiveResults[i];
      if (cogResult) {
        functions[i] = { ...functions[i], cognitive: cogResult.cognitiveComplexity } as FunctionMetrics;
      }
    }
  }

  const cyclomatics = functions.map((f) => f.cyclomatic);
  const cognitives = functions.map((f) => f.cognitive);

  const averageCyclomatic =
    cyclomatics.length > 0
      ? cyclomatics.reduce((sum, v) => sum + v, 0) / cyclomatics.length
      : 0;
  const maxCyclomatic =
    cyclomatics.length > 0 ? Math.max(...cyclomatics) : 0;
  const averageCognitive =
    cognitives.length > 0
      ? cognitives.reduce((sum, v) => sum + v, 0) / cognitives.length
      : 0;
  const maxCognitive =
    cognitives.length > 0 ? Math.max(...cognitives) : 0;

  // Basic maintainability estimate for Java (171 - 5.2*ln(V) - 0.23*G - 16.2*ln(L))
  // Using simplified heuristic since we lack full Halstead for Java
  const avgLoc =
    functions.length > 0
      ? functions.reduce((sum, f) => sum + f.loc, 0) / functions.length
      : slocLogical;
  const maintainabilityIndex = Math.max(
    0,
    Math.min(
      171,
      171 -
        5.2 * Math.log(Math.max(1, slocLogical)) -
        0.23 * averageCyclomatic -
        16.2 * Math.log(Math.max(1, avgLoc)),
    ),
  );

  // Code smells analysis
  const codeSmells = analyzeCodeSmells(source, "java", functions.length);

  return {
    filePath,
    language: "java",
    loc: totalLoc,
    slocLogical,
    functions,
    averageCyclomatic,
    maxCyclomatic,
    averageCognitive,
    maxCognitive,
    maintainabilityIndex,
    codeSmells: {
      consoleStatements: codeSmells.consoleStatements.length,
      todoFixmeCount: codeSmells.todoFixmeCount,
      magicNumberCount: codeSmells.magicNumbers.length,
      commentRatio: codeSmells.commentRatio,
      importCount: codeSmells.importCount,
      isGodFile: codeSmells.isGodFile,
    },
  };
}

// ── TS/JS Analysis via escomplex ───────────────────────────────────────

type EscomplexMethod = {
  name: string;
  lineStart: number;
  lineEnd: number;
  sloc: { logical: number };
  cyclomatic: number;
  halstead: {
    effort: number;
    difficulty: number;
    volume: number;
    vocabulary: number;
    length: number;
    bugs: number;
  };
  paramCount: number;
};

type EscomplexResult = {
  aggregate: {
    sloc: { logical: number };
    cyclomatic: number;
    halstead: {
      effort: number;
      difficulty: number;
      volume: number;
      vocabulary: number;
      length: number;
      bugs: number;
    };
  };
  methods: ReadonlyArray<EscomplexMethod>;
  maintainability: number;
};

function analyzeTsJsFile(
  filePath: string,
  source: string,
  language: "typescript" | "javascript",
): FileAstMetrics {
  const result = escomplex.analyzeModule(source, ESCOMPLEX_OPTIONS) as EscomplexResult;
  const lines = source.split("\n");
  const totalLoc = lines.length;

  // Compute real nesting depths using TypeScript compiler API
  const nestingDepths = computeNestingDepths(source, filePath);

  // Try to get cognitive complexity from cognitive-complexity-ts
  let cognitiveScores: Map<number, number> | null = null;
  if (getCognitiveComplexity) {
    try {
      const output = getCognitiveComplexity(source, filePath);
      if (output?.inner) {
        cognitiveScores = new Map<number, number>();
        for (const item of output.inner) {
          cognitiveScores.set(item.line, item.score);
        }
      }
    } catch {
      // Fall back to cyclomatic
    }
  }

  const functions: FunctionMetrics[] = result.methods.map((method) => {
    // Find matching nesting depth by overlapping line ranges
    const matchingNesting = nestingDepths.find(
      (nd) =>
        nd.startLine <= method.lineStart && nd.endLine >= method.lineEnd,
    ) ?? nestingDepths.find(
      // Looser match: function starts within the nesting range
      (nd) =>
        Math.abs(nd.startLine - method.lineStart) <= 1 &&
        Math.abs(nd.endLine - method.lineEnd) <= 1,
    );

    // Find matching cognitive complexity score by line number
    let cognitive = method.cyclomatic; // fallback
    if (cognitiveScores) {
      // Try exact match first, then nearby lines (escomplex and cognitive-complexity-ts
      // may report slightly different start lines)
      const exactScore = cognitiveScores.get(method.lineStart);
      if (exactScore !== undefined) {
        cognitive = exactScore;
      } else {
        // Check +/- 2 lines for a match
        for (let offset = -2; offset <= 2; offset++) {
          const nearbyScore = cognitiveScores.get(method.lineStart + offset);
          if (nearbyScore !== undefined) {
            cognitive = nearbyScore;
            break;
          }
        }
      }
    }

    return {
      name: method.name,
      startLine: method.lineStart,
      endLine: method.lineEnd,
      loc: method.sloc.logical,
      parameterCount: method.paramCount,
      cyclomatic: method.cyclomatic,
      cognitive,
      halstead: {
        effort: method.halstead.effort,
        difficulty: method.halstead.difficulty,
        volume: method.halstead.volume,
        vocabulary: method.halstead.vocabulary,
        length: method.halstead.length,
        bugs: method.halstead.bugs,
      },
      nestingDepth: matchingNesting?.maxNestingDepth ?? 0,
    };
  });

  const cyclomatics = functions.map((f) => f.cyclomatic);
  const cognitives = functions.map((f) => f.cognitive);

  const averageCyclomatic =
    cyclomatics.length > 0
      ? cyclomatics.reduce((sum, v) => sum + v, 0) / cyclomatics.length
      : result.aggregate.cyclomatic;
  const maxCyclomatic =
    cyclomatics.length > 0
      ? Math.max(...cyclomatics)
      : result.aggregate.cyclomatic;
  const averageCognitive =
    cognitives.length > 0
      ? cognitives.reduce((sum, v) => sum + v, 0) / cognitives.length
      : result.aggregate.cyclomatic;
  const maxCognitive =
    cognitives.length > 0
      ? Math.max(...cognitives)
      : result.aggregate.cyclomatic;

  // Code smells analysis
  const codeSmells = analyzeCodeSmells(source, language, functions.length);

  return {
    filePath,
    language,
    loc: totalLoc,
    slocLogical: result.aggregate.sloc.logical,
    functions,
    averageCyclomatic,
    maxCyclomatic,
    averageCognitive,
    maxCognitive,
    maintainabilityIndex: result.maintainability,
    codeSmells: {
      consoleStatements: codeSmells.consoleStatements.length,
      todoFixmeCount: codeSmells.todoFixmeCount,
      magicNumberCount: codeSmells.magicNumbers.length,
      commentRatio: codeSmells.commentRatio,
      importCount: codeSmells.importCount,
      isGodFile: codeSmells.isGodFile,
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────

export function createAstAnalysisService(
  deps: AstAnalysisDeps,
): AstAnalysisService {
  const { logger } = deps;

  function detectLanguage(filePath: string): SupportedLanguage | null {
    const ext = extname(filePath).toLowerCase();
    for (const [lang, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
      if ((extensions as ReadonlyArray<string>).includes(ext)) {
        return lang as SupportedLanguage;
      }
    }
    return null;
  }

  async function analyzeFile(
    filePath: string,
  ): Promise<Result<FileAstMetrics, DomainError>> {
    const language = detectLanguage(filePath);
    if (language === null) {
      return err(
        validationError(
          `Unsupported file extension: ${extname(filePath)}`,
          { filePath },
        ),
      );
    }

    let source: string;
    try {
      source = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown read error";
      return err(
        integrationError("filesystem", `Failed to read file ${filePath}: ${message}`),
      );
    }

    if (source.trim().length === 0) {
      return ok({
        filePath,
        language,
        loc: 0,
        slocLogical: 0,
        functions: [],
        averageCyclomatic: 0,
        maxCyclomatic: 0,
        averageCognitive: 0,
        maxCognitive: 0,
        maintainabilityIndex: 171,
      });
    }

    try {
      switch (language) {
        case "typescript":
        case "javascript": {
          const metrics = analyzeTsJsFile(filePath, source, language);
          logger.info("AST analysis complete", { filePath, language, functions: metrics.functions.length });
          return ok(metrics);
        }
        case "java": {
          const metrics = analyzeJavaFile(filePath, source);
          logger.info("AST analysis complete", { filePath, language, functions: metrics.functions.length });
          return ok(metrics);
        }
        default: {
          const _exhaustive: never = language;
          return err(
            validationError(`Unhandled language: ${String(_exhaustive)}`),
          );
        }
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown parse error";
      return err(
        integrationError(
          "ast-parser",
          `Failed to parse ${filePath}: ${message}`,
        ),
      );
    }
  }

  async function analyzeFiles(
    filePaths: ReadonlyArray<string>,
  ): Promise<Result<ReadonlyArray<FileAstMetrics>, DomainError>> {
    const results: FileAstMetrics[] = [];

    for (const filePath of filePaths) {
      const result = await analyzeFile(filePath);
      switch (result._tag) {
        case "Ok":
          results.push(result.value);
          break;
        case "Err":
          logger.error("Skipping file due to analysis error", {
            filePath,
            error: result.error,
          });
          break;
        default: {
          const _exhaustive: never = result;
          return _exhaustive;
        }
      }
    }

    return ok(results);
  }

  return {
    analyzeFile,
    analyzeFiles,
    detectLanguage,
  };
}
