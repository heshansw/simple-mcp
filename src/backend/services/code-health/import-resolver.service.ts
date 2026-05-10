import { resolve, dirname, extname } from "node:path";
import { access, constants } from "node:fs/promises";
import type { SupportedLanguage } from "@shared/schemas/code-health.schema.js";

export type ImportResolverDeps = {
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export type ImportResolverService = {
  resolveImports(filePath: string, source: string, language: SupportedLanguage): Promise<string[]>;
};

const TS_JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
const JAVA_EXTENSION = ".java";

export function createImportResolverService(_deps: ImportResolverDeps): ImportResolverService {
  return {
    async resolveImports(filePath, source, language) {
      const dir = dirname(filePath);
      const rawImports = extractRawImports(source, language);

      // Filter to relative imports only (skip npm packages, node:, etc.)
      const relativeImports = rawImports.filter(imp => imp.startsWith(".") || imp.startsWith("/"));

      const resolved: string[] = [];
      for (const imp of relativeImports) {
        const absolutePath = resolve(dir, imp);
        const found = await tryResolveFile(absolutePath, language);
        if (found) {
          resolved.push(found);
        }
      }

      return resolved;
    },
  };
}

function extractRawImports(source: string, language: SupportedLanguage): string[] {
  const imports: string[] = [];

  if (language === "java") {
    // Java: import com.foo.bar.ClassName;
    // We can't easily resolve Java imports to files without knowing the source root
    // Skip for now — Java import resolution requires project structure knowledge
    return imports;
  }

  // TS/JS import patterns
  const patterns = [
    /import\s+.*?\s+from\s+["']([^"']+)["']/g,           // import X from "path"
    /import\s+["']([^"']+)["']/g,                          // import "path"
    /export\s+.*?\s+from\s+["']([^"']+)["']/g,            // export X from "path"
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,               // require("path")
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,                // dynamic import("path")
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const importPath = match[1];
      if (importPath) {
        imports.push(importPath);
      }
    }
  }

  return [...new Set(imports)]; // Deduplicate
}

async function tryResolveFile(basePath: string, language: SupportedLanguage): Promise<string | null> {
  // If it already has an extension, try it directly
  const ext = extname(basePath);
  if (ext) {
    if (await fileExists(basePath)) return basePath;
    return null;
  }

  // Try with extensions
  const extensions = language === "java" ? [JAVA_EXTENSION] : TS_JS_EXTENSIONS;
  for (const tryExt of extensions) {
    const fullPath = basePath + tryExt;
    if (await fileExists(fullPath)) return fullPath;
  }

  // Try as directory with index file
  if (language !== "java") {
    for (const tryExt of TS_JS_EXTENSIONS) {
      const indexPath = resolve(basePath, `index${tryExt}`);
      if (await fileExists(indexPath)) return indexPath;
    }
  }

  return null;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
