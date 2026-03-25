import { readFile, readdir, stat, realpath, access } from "node:fs/promises";
import { resolve, extname, basename } from "node:path";
import { constants } from "node:fs";
import fg from "fast-glob";
import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  validationError,
  notFoundError,
  integrationError,
  authorizationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import type { FolderAccessRepository, FolderAccess } from "../db/repositories/folder-access.repository.js";
import type { RepoWorkspacesRepository } from "../db/repositories/repo-workspaces.repository.js";

// ── Output types ────────────────────────────────────────────────────────

export type DirectoryEntry = {
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size_bytes?: number;
  readonly modified_at?: string;
};

export type DirectoryListing = {
  readonly root: string;
  readonly relative_path: string;
  readonly entries: ReadonlyArray<DirectoryEntry>;
};

export type FileContent = {
  readonly absolute_path: string;
  readonly size_bytes: number;
  readonly content: string;
  readonly encoding: "utf-8" | "base64";
};

export type FileSearchMatch = {
  readonly relative_path: string;
  readonly size_bytes: number;
  readonly snippet?: string;
};

export type FileSearchResult = {
  readonly total_matched: number;
  readonly results: ReadonlyArray<FileSearchMatch>;
};

export type FileTreeNode = {
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size_bytes?: number;
  readonly children?: ReadonlyArray<FileTreeNode>;
};

export type FileTree = {
  readonly root: string;
  readonly tree: FileTreeNode;
};

export type FileSearchOptions = {
  readonly globPattern?: string;
  readonly contentQuery?: string;
  readonly maxResults: number;
  readonly includeContentSnippet: boolean;
};

export type WorkspaceSearchOptions = {
  readonly globPattern?: string;
  readonly contentQuery?: string;
  readonly maxResultsPerRepo: number;
  readonly includeContentSnippet: boolean;
};

export type WorkspaceFileMatch = FileSearchMatch & {
  readonly folder_access_id: string;
  readonly repo_name: string;
  readonly repo_root: string;
};

export type WorkspaceSearchResult = {
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly repos_searched: number;
  readonly total_matched: number;
  readonly skipped_repos: ReadonlyArray<{ folder_access_id: string; reason: string }>;
  readonly results: ReadonlyArray<WorkspaceFileMatch>;
};

export type RepoTreeEntry = {
  readonly folder_access_id: string;
  readonly repo_name: string;
  readonly root: string;
  readonly status: string;
  readonly tree: FileTreeNode | null;
};

export type WorkspaceTreeResult = {
  readonly workspace_id: string;
  readonly workspace_name: string;
  readonly repos: ReadonlyArray<RepoTreeEntry>;
};

// ── Dependencies ────────────────────────────────────────────────────────

export type LocalFilesystemDependencies = {
  logger: Logger;
  folderAccessRepo: FolderAccessRepository;
  workspacesRepo: RepoWorkspacesRepository;
};

// ── Service interface ───────────────────────────────────────────────────

export interface LocalFilesystemService {
  listDirectory(folderId: string, relativePath: string, maxDepth: number): Promise<Result<DirectoryListing, DomainError>>;
  readFile(folderId: string, relativePath: string, encoding: "utf-8" | "base64"): Promise<Result<FileContent, DomainError>>;
  searchFiles(folderId: string, options: FileSearchOptions): Promise<Result<FileSearchResult, DomainError>>;
  getFileTree(folderId: string, maxDepth: number, includeHidden: boolean): Promise<Result<FileTree, DomainError>>;
  verifyPath(folderId: string): Promise<Result<{ id: string; status: string }, DomainError>>;
  workspaceSearch(workspaceId: string, options: WorkspaceSearchOptions): Promise<Result<WorkspaceSearchResult, DomainError>>;
  workspaceTree(workspaceId: string, maxDepth: number, includeHidden: boolean): Promise<Result<WorkspaceTreeResult, DomainError>>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

const MAX_SEARCH_RESULTS_HARD_CAP = 200;

async function resolveAndSandbox(
  canonicalRoot: string,
  relativePath: string
): Promise<Result<string, DomainError>> {
  const resolved = resolve(canonicalRoot, relativePath);
  if (!resolved.startsWith(canonicalRoot)) {
    return err(authorizationError("Path traversal denied", "local-filesystem"));
  }

  // Resolve symlinks and verify still within root
  try {
    const real = await realpath(resolved);
    if (!real.startsWith(canonicalRoot)) {
      return err(authorizationError("Symlink resolves outside registered root", "local-filesystem"));
    }
    return ok(real);
  } catch {
    // Path may not exist yet (for listing purposes), use resolved
    return ok(resolved);
  }
}

function checkExtension(
  filePath: string,
  allowedExtensions: string[]
): Result<void, DomainError> {
  if (allowedExtensions.length === 0) return ok(undefined);
  const ext = extname(filePath);
  if (!allowedExtensions.includes(ext)) {
    return err(
      validationError(`File extension "${ext}" not in allowlist`, {
        allowed: allowedExtensions.join(", "),
      })
    );
  }
  return ok(undefined);
}

function hasBinaryContent(buffer: Buffer): boolean {
  return buffer.includes(0);
}

async function resolveFolderAccess(
  repo: FolderAccessRepository,
  folderId: string
): Promise<Result<FolderAccess, DomainError>> {
  const folder = await repo.findById(folderId);
  if (!folder) {
    return err(notFoundError("FolderAccess", folderId));
  }
  if (folder.status !== "active") {
    return err(
      integrationError("local-filesystem", `Folder is ${folder.status}`, 503)
    );
  }
  return ok(folder);
}

// ── Implementation ──────────────────────────────────────────────────────

export function createLocalFilesystemService(
  deps: LocalFilesystemDependencies
): LocalFilesystemService {
  const { logger, folderAccessRepo, workspacesRepo } = deps;

  async function buildTree(
    dirPath: string,
    canonicalRoot: string,
    currentDepth: number,
    maxDepth: number,
    includeHidden: boolean,
    allowedExtensions: string[]
  ): Promise<FileTreeNode> {
    const name = basename(dirPath);
    if (currentDepth > maxDepth) {
      return { name, type: "directory" };
    }

    const entries = await readdir(dirPath, { withFileTypes: true });
    const children: FileTreeNode[] = [];

    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith(".")) continue;

      const entryPath = resolve(dirPath, entry.name);
      if (!entryPath.startsWith(canonicalRoot)) continue;

      if (entry.isDirectory()) {
        const child = await buildTree(
          entryPath, canonicalRoot, currentDepth + 1, maxDepth, includeHidden, allowedExtensions
        );
        children.push(child);
      } else if (entry.isFile()) {
        if (allowedExtensions.length > 0 && !allowedExtensions.includes(extname(entry.name))) {
          continue;
        }
        const fileStat = await stat(entryPath);
        children.push({
          name: entry.name,
          type: "file",
          size_bytes: fileStat.size,
        });
      }
    }

    return { name, type: "directory", children };
  }

  async function searchInFolder(
    folder: FolderAccess,
    options: FileSearchOptions
  ): Promise<Result<FileSearchResult, DomainError>> {
    const root = folder.absolutePath;
    const allowedExts = JSON.parse(folder.allowedExtensions) as string[];
    const cap = Math.min(options.maxResults, MAX_SEARCH_RESULTS_HARD_CAP);

    try {
      // Build glob patterns
      const pattern = options.globPattern ?? "**/*";
      const ignore = ["**/node_modules/**", "**/.git/**"];

      const globOptions: fg.Options = {
        cwd: root,
        absolute: false,
        onlyFiles: true,
        dot: false,
        ignore,
      };
      if (!folder.recursive) {
        globOptions.deep = 1;
      }
      const files = await fg(pattern, globOptions);

      // Filter by extension
      const filtered = allowedExts.length > 0
        ? files.filter((f) => allowedExts.includes(extname(f)))
        : files;

      const results: FileSearchMatch[] = [];

      for (const relPath of filtered) {
        if (results.length >= cap) break;

        const absPath = resolve(root, relPath);
        if (!absPath.startsWith(root)) continue;

        const fileStat = await stat(absPath);
        const maxBytes = folder.maxFileSizeKb * 1024;
        if (fileStat.size > maxBytes) continue;

        if (options.contentQuery) {
          const buf = await readFile(absPath);
          if (hasBinaryContent(buf)) continue;
          const content = buf.toString("utf-8");
          const idx = content.indexOf(options.contentQuery);
          if (idx === -1) continue;

          const match: FileSearchMatch = {
            relative_path: relPath,
            size_bytes: fileStat.size,
          };

          if (options.includeContentSnippet) {
            const lineStart = content.lastIndexOf("\n", idx) + 1;
            const lineEnd = content.indexOf("\n", idx);
            const snippet = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
            results.push({ ...match, snippet });
          } else {
            results.push(match);
          }
        } else {
          results.push({
            relative_path: relPath,
            size_bytes: fileStat.size,
          });
        }
      }

      return ok({ total_matched: results.length, results });
    } catch (error) {
      logger.error({ error, root }, "Search failed");
      return err(integrationError("local-filesystem", "Search failed: I/O error", 500));
    }
  }

  return {
    async listDirectory(
      folderId: string,
      relativePath: string,
      _maxDepth: number
    ): Promise<Result<DirectoryListing, DomainError>> {
      try {
        const folderResult = await resolveFolderAccess(folderAccessRepo, folderId);
        if (folderResult._tag === "Err") return folderResult;
        const folder = folderResult.value;

        const pathResult = await resolveAndSandbox(folder.absolutePath, relativePath);
        if (pathResult._tag === "Err") return pathResult;
        const targetPath = pathResult.value;

        const entries = await readdir(targetPath, { withFileTypes: true });
        const dirEntries: DirectoryEntry[] = [];

        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const entryPath = resolve(targetPath, entry.name);

          if (entry.isFile()) {
            const fileStat = await stat(entryPath);
            dirEntries.push({
              name: entry.name,
              type: "file",
              size_bytes: fileStat.size,
              modified_at: fileStat.mtime.toISOString(),
            });
          } else if (entry.isDirectory()) {
            dirEntries.push({ name: entry.name, type: "directory" });
          }
        }

        return ok({
          root: folder.absolutePath,
          relative_path: relativePath,
          entries: dirEntries,
        });
      } catch (error) {
        logger.error({ error, folderId, relativePath }, "Failed to list directory");
        return err(integrationError("local-filesystem", "Failed to list directory", 500));
      }
    },

    async readFile(
      folderId: string,
      relativePath: string,
      encoding: "utf-8" | "base64"
    ): Promise<Result<FileContent, DomainError>> {
      try {
        const folderResult = await resolveFolderAccess(folderAccessRepo, folderId);
        if (folderResult._tag === "Err") return folderResult;
        const folder = folderResult.value;

        const allowedExts = JSON.parse(folder.allowedExtensions) as string[];
        const extCheck = checkExtension(relativePath, allowedExts);
        if (extCheck._tag === "Err") return extCheck;

        const pathResult = await resolveAndSandbox(folder.absolutePath, relativePath);
        if (pathResult._tag === "Err") return pathResult;
        const targetPath = pathResult.value;

        const fileStat = await stat(targetPath);
        const maxBytes = folder.maxFileSizeKb * 1024;
        if (fileStat.size > maxBytes) {
          return err(
            validationError("File exceeds size limit", {
              size_bytes: String(fileStat.size),
              limit_bytes: String(maxBytes),
            })
          );
        }

        const buffer = await readFile(targetPath);

        if (encoding === "utf-8" && hasBinaryContent(buffer)) {
          return err(
            validationError("Binary file cannot be read as utf-8. Use encoding: base64")
          );
        }

        const content = encoding === "base64"
          ? buffer.toString("base64")
          : buffer.toString("utf-8");

        return ok({
          absolute_path: targetPath,
          size_bytes: fileStat.size,
          content,
          encoding,
        });
      } catch (error) {
        logger.error({ error, folderId, relativePath }, "Failed to read file");
        return err(integrationError("local-filesystem", "Failed to read file", 500));
      }
    },

    async searchFiles(
      folderId: string,
      options: FileSearchOptions
    ): Promise<Result<FileSearchResult, DomainError>> {
      const folderResult = await resolveFolderAccess(folderAccessRepo, folderId);
      if (folderResult._tag === "Err") return folderResult;
      return searchInFolder(folderResult.value, options);
    },

    async getFileTree(
      folderId: string,
      maxDepth: number,
      includeHidden: boolean
    ): Promise<Result<FileTree, DomainError>> {
      try {
        const folderResult = await resolveFolderAccess(folderAccessRepo, folderId);
        if (folderResult._tag === "Err") return folderResult;
        const folder = folderResult.value;
        const allowedExts = JSON.parse(folder.allowedExtensions) as string[];

        const tree = await buildTree(
          folder.absolutePath, folder.absolutePath, 1, maxDepth, includeHidden, allowedExts
        );

        return ok({ root: folder.absolutePath, tree });
      } catch (error) {
        logger.error({ error, folderId }, "Failed to get file tree");
        return err(integrationError("local-filesystem", "Failed to get file tree", 500));
      }
    },

    async verifyPath(
      folderId: string
    ): Promise<Result<{ id: string; status: string }, DomainError>> {
      const folder = await folderAccessRepo.findById(folderId);
      if (!folder) return err(notFoundError("FolderAccess", folderId));

      try {
        await access(folder.absolutePath, constants.R_OK);
        await folderAccessRepo.update(folderId, { status: "active" });
        return ok({ id: folderId, status: "active" });
      } catch {
        await folderAccessRepo.update(folderId, { status: "path_not_found" });
        return ok({ id: folderId, status: "path_not_found" });
      }
    },

    async workspaceSearch(
      workspaceId: string,
      options: WorkspaceSearchOptions
    ): Promise<Result<WorkspaceSearchResult, DomainError>> {
      const workspace = await workspacesRepo.findById(workspaceId);
      if (!workspace) return err(notFoundError("RepoWorkspace", workspaceId));

      const folderIds = JSON.parse(workspace.folderIds) as string[];
      const skippedRepos: Array<{ folder_access_id: string; reason: string }> = [];
      const allResults: WorkspaceFileMatch[] = [];

      // Fan-out in parallel
      const tasks = folderIds.map(async (fid) => {
        const folder = await folderAccessRepo.findById(fid);
        if (!folder) {
          skippedRepos.push({ folder_access_id: fid, reason: "not_found" });
          return;
        }
        if (folder.status !== "active") {
          skippedRepos.push({ folder_access_id: fid, reason: folder.status });
          return;
        }

        const searchOpts = {
          maxResults: options.maxResultsPerRepo,
          includeContentSnippet: options.includeContentSnippet,
          ...(options.globPattern !== undefined ? { globPattern: options.globPattern } : {}),
          ...(options.contentQuery !== undefined ? { contentQuery: options.contentQuery } : {}),
        } satisfies FileSearchOptions;

        const result = await searchInFolder(folder, searchOpts);
        if (result._tag === "Err") {
          skippedRepos.push({ folder_access_id: fid, reason: "search_error" });
          return;
        }

        for (const match of result.value.results) {
          allResults.push({
            ...match,
            folder_access_id: fid,
            repo_name: folder.name,
            repo_root: folder.absolutePath,
          });
        }
      });

      await Promise.all(tasks);

      const reposSearched = folderIds.length - skippedRepos.length;

      // If all repos are unavailable
      if (reposSearched === 0) {
        return err(
          integrationError("local-filesystem", "All repos in workspace are unavailable", 503)
        );
      }

      return ok({
        workspace_id: workspaceId,
        workspace_name: workspace.name,
        repos_searched: reposSearched,
        total_matched: allResults.length,
        skipped_repos: skippedRepos,
        results: allResults,
      });
    },

    async workspaceTree(
      workspaceId: string,
      maxDepth: number,
      includeHidden: boolean
    ): Promise<Result<WorkspaceTreeResult, DomainError>> {
      const workspace = await workspacesRepo.findById(workspaceId);
      if (!workspace) return err(notFoundError("RepoWorkspace", workspaceId));

      const folderIds = JSON.parse(workspace.folderIds) as string[];

      // Fan-out in parallel
      const tasks = folderIds.map(async (fid): Promise<RepoTreeEntry> => {
        const folder = await folderAccessRepo.findById(fid);
        if (!folder) {
          return { folder_access_id: fid, repo_name: "unknown", root: "", status: "not_found", tree: null };
        }
        if (folder.status !== "active") {
          return { folder_access_id: fid, repo_name: folder.name, root: folder.absolutePath, status: folder.status, tree: null };
        }

        try {
          const allowedExts = JSON.parse(folder.allowedExtensions) as string[];
          const tree = await buildTree(
            folder.absolutePath, folder.absolutePath, 1, maxDepth, includeHidden, allowedExts
          );
          return { folder_access_id: fid, repo_name: folder.name, root: folder.absolutePath, status: "active", tree };
        } catch {
          return { folder_access_id: fid, repo_name: folder.name, root: folder.absolutePath, status: "error", tree: null };
        }
      });

      const repos = await Promise.all(tasks);

      return ok({
        workspace_id: workspaceId,
        workspace_name: workspace.name,
        repos,
      });
    },
  };
}
