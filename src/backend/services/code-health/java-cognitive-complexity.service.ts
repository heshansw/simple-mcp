type MethodCognitiveResult = {
  startLine: number;
  endLine: number;
  cognitiveComplexity: number;
};

export function computeJavaCognitiveComplexity(
  source: string,
  methods: Array<{ startLine: number; endLine: number }>,
): MethodCognitiveResult[] {
  const lines = source.split("\n");

  return methods.map((method) => {
    const methodLines = lines.slice(method.startLine - 1, method.endLine);

    let complexity = 0;
    let nestingLevel = 0;

    for (const line of methodLines) {
      const trimmed = line.trim();

      // Skip comments and empty lines
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*") ||
        trimmed === ""
      ) {
        continue;
      }

      // B1: Increment for control flow keywords
      // Each match gets +1 base, plus nesting level for B2

      // if (not else if)
      if (/\bif\s*\(/.test(trimmed) && !/\belse\s+if\b/.test(trimmed)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }
      // else if (only +1 base, no nesting increment per SonarSource rules)
      else if (/\belse\s+if\s*\(/.test(trimmed)) {
        complexity += 1;
      }
      // else
      else if (
        /\belse\s*\{/.test(trimmed) ||
        trimmed === "else" ||
        trimmed === "} else {"
      ) {
        complexity += 1;
      }

      // for, while, do
      if (/\bfor\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }
      if (/\bwhile\s*\(/.test(trimmed) && !/\bdo\b/.test(trimmed)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }
      if (/\bdo\s*\{/.test(trimmed)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }

      // switch
      if (/\bswitch\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }

      // catch
      if (/\bcatch\s*\(/.test(trimmed)) {
        complexity += 1 + nestingLevel;
        nestingLevel++;
      }

      // Ternary operator (? but not ?. or ?=)
      const ternaryCount = (trimmed.match(/\?(?!=)/g) || []).length;
      complexity += ternaryCount * (1 + nestingLevel);

      // Logical operators (each sequence break adds +1, no nesting penalty)
      const andCount = (trimmed.match(/&&/g) || []).length;
      const orCount = (trimmed.match(/\|\|/g) || []).length;
      complexity += andCount + orCount;

      // Track closing braces to adjust nesting level
      const opens = (trimmed.match(/\{/g) || []).length;
      const closes = (trimmed.match(/\}/g) || []).length;

      if (closes > opens) {
        nestingLevel = Math.max(0, nestingLevel - (closes - opens));
      }
    }

    return {
      startLine: method.startLine,
      endLine: method.endLine,
      cognitiveComplexity: complexity,
    };
  });
}
