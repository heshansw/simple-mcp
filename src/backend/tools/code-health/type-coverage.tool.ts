import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TypeCoverageInputSchema } from "@shared/schemas/code-health.schema.js";
import type { TypeCoverageReport } from "@shared/schemas/code-health.schema.js";

// ── Types ──────────────────────────────────────────────────────────────

export type TypeCoverageToolDeps = {
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

// ── Regex patterns ─────────────────────────────────────────────────────

// Strip single-line and multi-line comments to avoid false positives
function stripComments(source: string): string {
  // Remove single-line comments
  let result = source.replace(/\/\/.*$/gm, "");
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove string literals to avoid matching inside strings
  result = result.replace(/(["'`])(?:(?!\1|\\).|\\.)*\1/g, '""');
  return result;
}

type AnyMatch = {
  line: number;
  column: number;
  text: string;
};

function findExplicitAny(source: string): ReadonlyArray<AnyMatch> {
  const matches: AnyMatch[] = [];
  const lines = source.split("\n");

  // Match `: any`, `<any>`, `as any` but not `// any` or inside strings
  const anyPattern = /\bany\b/g;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Skip comment-only lines
    const stripped = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
    let match: RegExpExecArray | null;
    anyPattern.lastIndex = 0;

    while ((match = anyPattern.exec(stripped)) !== null) {
      matches.push({
        line: i + 1,
        column: match.index + 1,
        text: line.trim(),
      });
    }
  }

  return matches;
}

type MissingReturnType = {
  line: number;
  functionName: string;
};

function findMissingReturnTypes(source: string): ReadonlyArray<MissingReturnType> {
  const results: MissingReturnType[] = [];
  const lines = source.split("\n");

  // Pattern: `function name(` or `name(` followed by `) {` without `: Type {`
  // Matches function declarations without return type annotations
  const funcDeclPattern = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/;
  const funcDeclWithReturnType = /(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*:\s*\S+/;

  // Arrow functions assigned to const/let: `const name = (...) => {`
  const arrowPattern = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/;
  const arrowWithReturnType = /(?:const|let|var)\s+\w+\s*(?::\s*\S+\s*)?=\s*(?:async\s+)?\([^)]*\)\s*:\s*\S+\s*=>/;

  // Method definitions: `name(` followed by `) {` without `: Type {`
  const methodPattern = /^\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/;
  const methodWithReturnType = /^\s+(?:async\s+)?\w+\s*\([^)]*\)\s*:\s*\S+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Skip comment lines
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      continue;
    }

    // Check function declarations
    const funcMatch = funcDeclPattern.exec(line);
    if (funcMatch && !funcDeclWithReturnType.test(line)) {
      results.push({ line: i + 1, functionName: funcMatch[1] ?? "anonymous" });
      continue;
    }

    // Check arrow functions
    const arrowMatch = arrowPattern.exec(line);
    if (arrowMatch && !arrowWithReturnType.test(line)) {
      results.push({ line: i + 1, functionName: arrowMatch[1] ?? "anonymous" });
      continue;
    }

    // Check method definitions
    const methodMatch = methodPattern.exec(line);
    if (methodMatch && !methodWithReturnType.test(line)) {
      // Exclude common non-method patterns
      const name = methodMatch[1] ?? "";
      if (name !== "if" && name !== "for" && name !== "while" && name !== "switch" && name !== "catch") {
        results.push({ line: i + 1, functionName: name });
      }
    }
  }

  return results;
}

function countTypeAssertions(source: string): number {
  const stripped = stripComments(source);
  // `as SomeType` assertions (excluding `as const`)
  const asAssertions = (stripped.match(/\bas\s+(?!const\b)\w+/g) ?? []).length;
  // Angle bracket assertions `<Type>value` — avoid JSX by requiring non-/ after >
  // This is a rough heuristic; JSX will produce false positives in .tsx files
  const angleBracketAssertions = (stripped.match(/<(\w+)>\s*(?!\/)/g) ?? []).length;
  return asAssertions + angleBracketAssertions;
}

function countTypeAnnotations(source: string): number {
  const stripped = stripComments(source);
  // Count `: SomeType` patterns (parameter types, variable types, return types)
  const annotations = stripped.match(/:\s*(?!\/\/)\w+/g) ?? [];
  return annotations.length;
}

// ── Registration ───────────────────────────────────────────────────────

export function registerTypeCoverageTool(
  server: McpServer,
  deps: TypeCoverageToolDeps,
): void {
  server.tool(
    "code_health_type_coverage",
    "Analyze TypeScript type safety: count 'any' usages, implicit any, missing return types, and type assertion density.",
    TypeCoverageInputSchema.shape,
    async (args) => {
      try {
        const input = TypeCoverageInputSchema.parse(args);
        deps.logger.info("Analyzing type coverage", { targetPath: input.targetPath });

        // Verify path exists and is a TypeScript file
        const targetStat = await stat(input.targetPath);

        if (!targetStat.isFile()) {
          return {
            content: [{ type: "text" as const, text: "Error: Target path must be a file for type coverage analysis." }],
            isError: true,
          };
        }

        const ext = extname(input.targetPath);
        if (ext !== ".ts" && ext !== ".tsx") {
          return {
            content: [{ type: "text" as const, text: `Error: Type coverage analysis only supports .ts and .tsx files, got: ${ext}` }],
            isError: true,
          };
        }

        const source = await readFile(input.targetPath, "utf-8");
        const strippedSource = stripComments(source);

        // Count explicit `any` usages
        const anyLocations = findExplicitAny(strippedSource);
        const anyCount = anyLocations.length;

        // Find missing return types
        const missingReturnTypes = findMissingReturnTypes(source);

        // Count type assertions
        const typeAssertionCount = countTypeAssertions(source);

        // Estimate coverage: annotations vs any usages
        const totalAnnotations = countTypeAnnotations(strippedSource);
        const coveragePercentage =
          totalAnnotations > 0
            ? Math.round(
                ((totalAnnotations - anyCount) / totalAnnotations) * 100 * 100,
              ) / 100
            : anyCount === 0
              ? 100
              : 0;

        const report: TypeCoverageReport = {
          filePath: input.targetPath,
          coveragePercentage: Math.max(0, Math.min(100, coveragePercentage)),
          anyCount,
          implicitAnyLocations: anyLocations.map((a) => ({
            line: a.line,
            column: a.column,
            text: a.text,
          })),
          missingReturnTypes: [...missingReturnTypes],
          typeAssertionCount,
        };

        deps.logger.info("Type coverage analysis complete", {
          anyCount,
          coverage: report.coveragePercentage,
          assertions: typeAssertionCount,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  );
}
