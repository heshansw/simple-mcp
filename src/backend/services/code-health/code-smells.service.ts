import type { SupportedLanguage } from "@shared/schemas/code-health.schema.js";

export type CodeSmellLocation = {
  readonly line: number;
  readonly text: string;
};

export type CodeSmellsResult = {
  readonly consoleStatements: ReadonlyArray<CodeSmellLocation>;
  readonly todoFixmeCount: number;
  readonly todoLocations: ReadonlyArray<CodeSmellLocation>;
  readonly magicNumbers: ReadonlyArray<CodeSmellLocation>;
  readonly commentRatio: number;
  readonly importCount: number;
  readonly isGodFile: boolean;
  readonly fileLocCount: number;
  readonly functionCount: number;
};

export function analyzeCodeSmells(source: string, language: SupportedLanguage, functionCount: number): CodeSmellsResult {
  const lines = source.split("\n");
  const fileLocCount = lines.length;

  const consoleStatements: CodeSmellLocation[] = [];
  const todoLocations: CodeSmellLocation[] = [];
  const magicNumbers: CodeSmellLocation[] = [];
  let commentLineCount = 0;
  let importCount = 0;
  let inBlockComment = false;

  // Console/debug patterns per language
  const consolePatterns = language === "java"
    ? [/System\.(out|err)\.(print|println|printf)\s*\(/]
    : [/console\.(log|warn|error|debug|info|trace|dir|table|assert)\s*\(/, /debugger\b/];

  // Import patterns per language
  const importPatterns = language === "java"
    ? [/^\s*import\s+/]
    : [/^\s*import\s+/, /\brequire\s*\(/, /^\s*export\s+.*\s+from\s+/];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const lineNum = i + 1;

    // Track block comments
    if (inBlockComment) {
      commentLineCount++;
      if (trimmed.includes("*/")) {
        inBlockComment = false;
      }
      continue;
    }

    if (trimmed.startsWith("/*")) {
      commentLineCount++;
      inBlockComment = !trimmed.includes("*/");
      // Check for TODO/FIXME in comment
      checkTodo(trimmed, lineNum, todoLocations);
      continue;
    }

    if (trimmed.startsWith("//")) {
      commentLineCount++;
      checkTodo(trimmed, lineNum, todoLocations);
      continue;
    }

    // Check inline comments for TODO
    const inlineComment = line.match(/\/\/(.*)$/);
    if (inlineComment) {
      checkTodo(inlineComment[1] ?? "", lineNum, todoLocations);
    }

    // Console/debug statements
    for (const pattern of consolePatterns) {
      if (pattern.test(trimmed)) {
        consoleStatements.push({ line: lineNum, text: trimmed.slice(0, 80) });
        break;
      }
    }

    // Import count
    for (const pattern of importPatterns) {
      if (pattern.test(trimmed)) {
        importCount++;
        break;
      }
    }

    // Magic numbers (not in const/enum declarations, not 0/1/-1/2)
    if (!trimmed.startsWith("const ") && !trimmed.startsWith("final ") && !trimmed.startsWith("static ") && !trimmed.startsWith("import ")) {
      const numberMatches = trimmed.matchAll(/(?<![.\w])(-?\d+\.?\d*)\b/g);
      for (const match of numberMatches) {
        const num = match[1] ?? "";
        const val = parseFloat(num);
        // Skip common non-magic numbers
        if (!isNaN(val) && val !== 0 && val !== 1 && val !== -1 && val !== 2 && val !== 100 && val !== 1000) {
          // Skip if it's in a string
          if (!isInString(line, match.index ?? 0)) {
            magicNumbers.push({ line: lineNum, text: `${num} in: ${trimmed.slice(0, 60)}` });
          }
        }
      }
    }
  }

  const codeLines = fileLocCount - commentLineCount;
  const commentRatio = codeLines > 0 ? Math.round((commentLineCount / fileLocCount) * 100) : 0;
  const isGodFile = fileLocCount > 500 && functionCount > 10;

  return {
    consoleStatements,
    todoFixmeCount: todoLocations.length,
    todoLocations,
    magicNumbers: magicNumbers.slice(0, 20), // Cap at 20 to avoid noise
    commentRatio,
    importCount,
    isGodFile,
    fileLocCount,
    functionCount,
  };
}

function checkTodo(text: string, line: number, results: CodeSmellLocation[]): void {
  if (/\b(TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)\b/i.test(text)) {
    results.push({ line, text: text.trim().slice(0, 80) });
  }
}

function isInString(line: string, index: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < index; i++) {
    const ch = line[i];
    const prev = i > 0 ? line[i - 1] : "";
    if (ch === "'" && prev !== "\\" && !inDouble && !inTemplate) inSingle = !inSingle;
    if (ch === '"' && prev !== "\\" && !inSingle && !inTemplate) inDouble = !inDouble;
    if (ch === '`' && prev !== "\\" && !inSingle && !inDouble) inTemplate = !inTemplate;
  }
  return inSingle || inDouble || inTemplate;
}
