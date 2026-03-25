import { useState } from "react";
import {
  useFolderAccessList,
  useCreateFolderAccess,
  useDeleteFolderAccess,
  useVerifyFolderAccess,
  useUpdateFolderAccess,
} from "@frontend/api/folder-access.api";
import type { FolderAccessEntry, CreateFolderAccessInput } from "@frontend/api/folder-access.api";
import {
  useWorkspacesList,
  useCreateWorkspace,
  useDeleteWorkspace,
} from "@frontend/api/workspaces.api";
import type { WorkspaceEntry } from "@frontend/api/workspaces.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

// ── Helpers ──────────────────────────────────────────────────────────

function parseJsonArray(json: string): string[] {
  try {
    return JSON.parse(json) as string[];
  } catch {
    return [];
  }
}

function statusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case "active":
      return { bg: "#dcfce7", fg: "#166534" };
    case "path_not_found":
      return { bg: "#fee2e2", fg: "#991b1b" };
    case "disabled":
      return { bg: "#f3f4f6", fg: "#374151" };
    default:
      return { bg: "#f3f4f6", fg: "#374151" };
  }
}

// ── Folder Card ──────────────────────────────────────────────────────

type FolderCardProps = {
  folder: FolderAccessEntry;
  onDelete: (id: string) => void;
  onVerify: (id: string) => void;
  onToggle: (id: string, currentStatus: string) => void;
  isDeleting: boolean;
  isVerifying: boolean;
};

function FolderCard({ folder, onDelete, onVerify, onToggle, isDeleting, isVerifying }: FolderCardProps) {
  const { bg, fg } = statusColor(folder.status);
  const extensions = parseJsonArray(folder.allowedExtensions);

  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.375rem",
        backgroundColor: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
        <div>
          <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.125rem" }}>{folder.name}</h3>
          <code style={{ fontSize: "0.8rem", color: "#666", wordBreak: "break-all" }}>{folder.absolutePath}</code>
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            fontSize: "0.75rem",
            fontWeight: "500",
            backgroundColor: bg,
            color: fg,
          }}
        >
          {folder.status.replace(/_/g, " ")}
        </span>
      </div>

      <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "#888", marginTop: "0.5rem" }}>
        <span>Max file: {folder.maxFileSizeKb} KB</span>
        <span>{folder.recursive ? "Recursive" : "Top-level only"}</span>
        {extensions.length > 0 && <span>Exts: {extensions.join(", ")}</span>}
        {extensions.length === 0 && <span>All extensions</span>}
      </div>

      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          onClick={() => onVerify(folder.id)}
          disabled={isVerifying}
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: "#3b82f6",
            color: "#fff",
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            cursor: "pointer",
            border: "none",
            opacity: isVerifying ? 0.6 : 1,
          }}
        >
          {isVerifying ? "Verifying..." : "Verify Path"}
        </button>
        <button
          onClick={() => onToggle(folder.id, folder.status)}
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: folder.status === "disabled" ? "#10b981" : "#f59e0b",
            color: "#fff",
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            cursor: "pointer",
            border: "none",
          }}
        >
          {folder.status === "disabled" ? "Enable" : "Disable"}
        </button>
        <button
          onClick={() => onDelete(folder.id)}
          disabled={isDeleting}
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: "#ef4444",
            color: "#fff",
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            cursor: "pointer",
            border: "none",
            opacity: isDeleting ? 0.6 : 1,
          }}
        >
          {isDeleting ? "Removing..." : "Remove"}
        </button>
      </div>
    </div>
  );
}

// ── Register Folder Form ─────────────────────────────────────────────

type RegisterFolderFormProps = {
  onSubmit: (input: CreateFolderAccessInput) => void;
  isPending: boolean;
  error: Error | null;
};

function RegisterFolderForm({ onSubmit, isPending, error }: RegisterFolderFormProps) {
  const [name, setName] = useState("");
  const [absolutePath, setAbsolutePath] = useState("");
  const [extensions, setExtensions] = useState("");
  const [maxSize, setMaxSize] = useState(512);
  const [recursive, setRecursive] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedExts = extensions
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onSubmit({
      name: name.trim(),
      absolutePath: absolutePath.trim(),
      ...(parsedExts.length > 0 ? { allowedExtensions: parsedExts } : {}),
      maxFileSizeKb: maxSize,
      recursive,
    });

    setName("");
    setAbsolutePath("");
    setExtensions("");
    setMaxSize(512);
    setRecursive(true);
  };

  const inputStyle = {
    width: "100%",
    padding: "0.5rem",
    border: "1px solid #d1d5db",
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: "600" as const,
    color: "#374151",
    marginBottom: "0.25rem",
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #e5e7eb", borderRadius: "0.375rem", backgroundColor: "#fff" }}>
      <h3 style={{ margin: "0 0 1rem 0" }}>Register a Folder</h3>

      {error && <ErrorDisplay error={error} message="Failed to register folder" />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={labelStyle}>Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-project"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Absolute Path</label>
          <input
            value={absolutePath}
            onChange={(e) => setAbsolutePath(e.target.value)}
            placeholder="/Users/you/projects/my-project"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Allowed Extensions (comma-separated, empty = all)</label>
          <input
            value={extensions}
            onChange={(e) => setExtensions(e.target.value)}
            placeholder=".ts, .tsx, .json, .md"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Max File Size (KB)</label>
          <input
            type="number"
            value={maxSize}
            onChange={(e) => setMaxSize(Number(e.target.value))}
            min={1}
            max={10240}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <input
            type="checkbox"
            id="recursive"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          <label htmlFor="recursive" style={{ fontSize: "0.875rem" }}>Recursive (include subdirectories)</label>
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending || !name.trim() || !absolutePath.trim()}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1.5rem",
          backgroundColor: "#10b981",
          color: "#fff",
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          cursor: "pointer",
          border: "none",
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {isPending ? "Registering..." : "Register Folder"}
      </button>
    </form>
  );
}

// ── Create Workspace Form ────────────────────────────────────────────

type CreateWorkspaceFormProps = {
  folders: FolderAccessEntry[];
  onSubmit: (input: { name: string; description?: string; folderIds: string[] }) => void;
  isPending: boolean;
  error: Error | null;
};

function CreateWorkspaceForm({ folders, onSubmit, isPending, error }: CreateWorkspaceFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleToggleFolder = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDesc = description.trim();
    onSubmit({
      name: name.trim(),
      ...(trimmedDesc ? { description: trimmedDesc } : {}),
      folderIds: selectedIds,
    });
    setName("");
    setDescription("");
    setSelectedIds([]);
  };

  const inputStyle = {
    width: "100%",
    padding: "0.5rem",
    border: "1px solid #d1d5db",
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: "600" as const,
    color: "#374151",
    marginBottom: "0.25rem",
  };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: "2rem", padding: "1rem", border: "1px solid #e5e7eb", borderRadius: "0.375rem", backgroundColor: "#fff" }}>
      <h3 style={{ margin: "0 0 1rem 0" }}>Create a Workspace</h3>
      <p style={{ margin: "0 0 1rem 0", fontSize: "0.8rem", color: "#666" }}>
        Group 2 or more registered folders into a workspace for cross-repo search and analysis.
      </p>

      {error && <ErrorDisplay error={error} message="Failed to create workspace" />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
        <div>
          <label style={labelStyle}>Workspace Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="checkout-microservices"
            required
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="All services for the checkout flow"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ marginTop: "1rem" }}>
        <label style={labelStyle}>Select Folders (min 2)</label>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "200px", overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "0.5rem" }}>
          {folders.length === 0 && (
            <p style={{ fontSize: "0.8rem", color: "#999", margin: "0" }}>No folders registered yet.</p>
          )}
          {folders.map((f) => (
            <label key={f.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={selectedIds.includes(f.id)}
                onChange={() => handleToggleFolder(f.id)}
              />
              <span style={{ fontWeight: "500" }}>{f.name}</span>
              <span style={{ fontSize: "0.75rem", color: "#888" }}>({f.absolutePath})</span>
            </label>
          ))}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending || !name.trim() || selectedIds.length < 2}
        style={{
          marginTop: "1rem",
          padding: "0.5rem 1.5rem",
          backgroundColor: "#8b5cf6",
          color: "#fff",
          borderRadius: "0.375rem",
          fontSize: "0.875rem",
          cursor: "pointer",
          border: "none",
          opacity: isPending || selectedIds.length < 2 ? 0.6 : 1,
        }}
      >
        {isPending ? "Creating..." : `Create Workspace (${selectedIds.length} repos)`}
      </button>
    </form>
  );
}

// ── Workspace Card ───────────────────────────────────────────────────

type WorkspaceCardProps = {
  workspace: WorkspaceEntry;
  folders: FolderAccessEntry[];
  onDelete: (id: string) => void;
  isDeleting: boolean;
};

function WorkspaceCard({ workspace, folders, onDelete, isDeleting }: WorkspaceCardProps) {
  const folderIds = parseJsonArray(workspace.folderIds);
  const repoNames = folderIds.map((fid) => {
    const folder = folders.find((f) => f.id === fid);
    return folder ? folder.name : `(deleted: ${fid.slice(0, 8)})`;
  });

  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.375rem",
        backgroundColor: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div>
          <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.125rem" }}>{workspace.name}</h3>
          {workspace.description && (
            <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8rem", color: "#666" }}>{workspace.description}</p>
          )}
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "0.25rem 0.75rem",
            borderRadius: "9999px",
            fontSize: "0.75rem",
            fontWeight: "500",
            backgroundColor: "#ede9fe",
            color: "#5b21b6",
          }}
        >
          {folderIds.length} repos
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginTop: "0.5rem" }}>
        {repoNames.map((name, i) => (
          <span
            key={i}
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "0.25rem",
              fontSize: "0.75rem",
              backgroundColor: "#f3f4f6",
              color: "#374151",
            }}
          >
            {name}
          </span>
        ))}
      </div>

      <div style={{ marginTop: "0.75rem" }}>
        <button
          onClick={() => onDelete(workspace.id)}
          disabled={isDeleting}
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: "#ef4444",
            color: "#fff",
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            cursor: "pointer",
            border: "none",
            opacity: isDeleting ? 0.6 : 1,
          }}
        >
          {isDeleting ? "Deleting..." : "Delete Workspace"}
        </button>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export function LocalReposPage() {
  const { data: folders, isLoading: foldersLoading, error: foldersError } = useFolderAccessList();
  const { data: workspaces, isLoading: workspacesLoading, error: workspacesError } = useWorkspacesList();

  const createFolder = useCreateFolderAccess();
  const deleteFolder = useDeleteFolderAccess();
  const verifyFolder = useVerifyFolderAccess();
  const updateFolder = useUpdateFolderAccess();

  const createWorkspace = useCreateWorkspace();
  const deleteWorkspace = useDeleteWorkspace();

  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [verifyingFolderId, setVerifyingFolderId] = useState<string | null>(null);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);

  const handleDeleteFolder = async (id: string) => {
    if (!confirm("Remove this registered folder? This does not delete files on disk.")) return;
    setDeletingFolderId(id);
    try {
      await deleteFolder.mutateAsync(id);
    } finally {
      setDeletingFolderId(null);
    }
  };

  const handleVerifyFolder = async (id: string) => {
    setVerifyingFolderId(id);
    try {
      await verifyFolder.mutateAsync(id);
    } finally {
      setVerifyingFolderId(null);
    }
  };

  const handleToggleFolder = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "disabled" ? "active" : "disabled";
    await updateFolder.mutateAsync({ id, data: { status: newStatus as "active" | "disabled" } });
  };

  const handleDeleteWorkspace = async (id: string) => {
    if (!confirm("Delete this workspace?")) return;
    setDeletingWorkspaceId(id);
    try {
      await deleteWorkspace.mutateAsync(id);
    } finally {
      setDeletingWorkspaceId(null);
    }
  };

  if (foldersLoading || workspacesLoading) {
    return <LoadingSpinner message="Loading local repos..." />;
  }

  if (foldersError) {
    return <ErrorDisplay error={foldersError} message="Failed to load folders" />;
  }

  if (workspacesError) {
    return <ErrorDisplay error={workspacesError} message="Failed to load workspaces" />;
  }

  const folderList = folders ?? [];
  const workspaceList = workspaces ?? [];

  return (
    <div>
      <h1 style={{ marginTop: "0" }}>Local Repos & Workspaces</h1>
      <p style={{ color: "#666", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Register local filesystem paths for read-only code analysis. Group repos into workspaces for cross-repo search.
      </p>

      {/* Register Folder Form */}
      <RegisterFolderForm
        onSubmit={(input) => createFolder.mutate(input)}
        isPending={createFolder.isPending}
        error={createFolder.error}
      />

      {/* Registered Folders */}
      <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        Registered Folders ({folderList.length})
      </h2>

      {folderList.length === 0 ? (
        <p style={{ color: "#999", fontSize: "0.875rem" }}>No folders registered yet. Use the form above to add one.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
          {folderList.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              onDelete={handleDeleteFolder}
              onVerify={handleVerifyFolder}
              onToggle={handleToggleFolder}
              isDeleting={deletingFolderId === folder.id}
              isVerifying={verifyingFolderId === folder.id}
            />
          ))}
        </div>
      )}

      {/* Create Workspace Form — only show when there are 2+ folders */}
      {folderList.length >= 2 && (
        <CreateWorkspaceForm
          folders={folderList}
          onSubmit={(input) => createWorkspace.mutate(input)}
          isPending={createWorkspace.isPending}
          error={createWorkspace.error}
        />
      )}

      {/* Workspaces */}
      <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>
        Workspaces ({workspaceList.length})
      </h2>

      {workspaceList.length === 0 ? (
        <p style={{ color: "#999", fontSize: "0.875rem" }}>
          {folderList.length < 2
            ? "Register at least 2 folders to create a workspace."
            : "No workspaces created yet. Use the form above to group repos."}
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))", gap: "1rem" }}>
          {workspaceList.map((ws) => (
            <WorkspaceCard
              key={ws.id}
              workspace={ws}
              folders={folderList}
              onDelete={handleDeleteWorkspace}
              isDeleting={deletingWorkspaceId === ws.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
