import { Link } from "@tanstack/react-router";
import type { ConnectionConfig } from "@shared/schemas/connection.schema";
import { StatusBadge } from "@frontend/components/status-badge";

type ConnectionCardProps = {
  connection: ConnectionConfig;
  onDelete?: (id: string) => void;
  isDeleting?: boolean;
};

export function ConnectionCard({
  connection,
  onDelete,
  isDeleting,
}: ConnectionCardProps) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.375rem",
        backgroundColor: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          marginBottom: "0.75rem",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.125rem" }}>
            {connection.name}
          </h3>
          <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
            {connection.integrationType.toUpperCase()}
          </p>
        </div>
        <StatusBadge status={connection.status} />
      </div>

      {connection.baseUrl && (
        <p style={{ margin: "0.5rem 0", fontSize: "0.875rem", color: "#666" }}>
          {connection.baseUrl}
        </p>
      )}

      <p style={{ margin: "0.5rem 0", fontSize: "0.875rem", color: "#999" }}>
        Auth: {connection.authMethod.replace(/_/g, " ")}
      </p>

      <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
        <Link
          to={`/connections/$connectionId`}
          params={{ connectionId: connection.id }}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#3b82f6",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
            border: "none",
          }}
        >
          Edit
        </Link>
        <button
          onClick={() => onDelete?.(connection.id)}
          disabled={isDeleting}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#ef4444",
            color: "#fff",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
            border: "none",
            opacity: isDeleting ? 0.6 : 1,
          }}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );
}
