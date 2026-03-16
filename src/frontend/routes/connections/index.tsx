import { Link } from "@tanstack/react-router";
import {
  useConnections,
  useDeleteConnection,
} from "@frontend/api/connections.api";
import { ConnectionCard } from "@frontend/components/connection-card";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState } from "react";

export function ConnectionsListPage() {
  const { data: connections, isLoading, error } = useConnections();
  const deleteConnection = useDeleteConnection();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this connection?")) {
      return;
    }

    setDeletingId(id);
    try {
      await deleteConnection.mutateAsync(id);
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading connections..." />;
  }

  if (error) {
    return (
      <ErrorDisplay error={error} message="Failed to load connections" />
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem",
        }}
      >
        <h1 style={{ marginTop: "0" }}>Connections</h1>
        <Link
          to="/connections/new"
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#10b981",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          + New Connection
        </Link>
      </div>

      {deleteConnection.error && (
        <ErrorDisplay
          error={deleteConnection.error}
          message="Failed to delete connection"
        />
      )}

      {connections && connections.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
            textAlign: "center",
            color: "#999",
          }}
        >
          <p>No connections configured yet.</p>
          <Link
            to="/connections/new"
            style={{
              color: "#3b82f6",
              textDecoration: "none",
              fontWeight: "500",
            }}
          >
            Create your first connection
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem" }}>
          {connections?.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              onDelete={handleDelete}
              isDeleting={deletingId === connection.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
