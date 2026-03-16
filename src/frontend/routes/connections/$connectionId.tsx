import { useParams, useNavigate } from "@tanstack/react-router";
import {
  useConnection,
  useUpdateConnection,
  useDeleteConnection,
} from "@frontend/api/connections.api";
import { StatusBadge } from "@frontend/components/status-badge";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState } from "react";
import { AuthMethodSchema } from "@shared/schemas/connection.schema";

export function ConnectionDetailPage() {
  const { connectionId } = useParams({ from: "/connections/$connectionId" });
  const navigate = useNavigate();
  const { data: connection, isLoading, error } = useConnection(connectionId);
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(
    connection ? {
      name: connection.name,
      baseUrl: connection.baseUrl || "",
      authMethod: connection.authMethod,
    } : { name: "", baseUrl: "", authMethod: "oauth2" as const }
  );

  if (isLoading) {
    return <LoadingSpinner message="Loading connection..." />;
  }

  if (error || !connection) {
    return (
      <ErrorDisplay error={error} message="Failed to load connection" />
    );
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await updateConnection.mutateAsync({
        id: connection.id,
        name: formData.name,
        integrationType: connection.integrationType,
        baseUrl: formData.baseUrl || undefined,
        authMethod: formData.authMethod,
        status: connection.status,
      });
      setIsEditing(false);
    } catch (err) {
      // Error is displayed by updateConnection.error
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        "Are you sure you want to delete this connection? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      await deleteConnection.mutateAsync(connection.id);
      navigate({ to: "/connections" });
    } catch (err) {
      // Error is displayed by deleteConnection.error
    }
  };

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
        <h1 style={{ marginTop: "0" }}>{connection.name}</h1>
        <StatusBadge status={connection.status} />
      </div>

      {updateConnection.error && (
        <ErrorDisplay
          error={updateConnection.error}
          message="Failed to update connection"
        />
      )}

      {deleteConnection.error && (
        <ErrorDisplay
          error={deleteConnection.error}
          message="Failed to delete connection"
        />
      )}

      <div
        style={{
          maxWidth: "600px",
          padding: "2rem",
          backgroundColor: "#fff",
          borderRadius: "0.375rem",
          border: "1px solid #e5e7eb",
        }}
      >
        {!isEditing ? (
          <div>
            <div style={{ marginBottom: "2rem" }}>
              <h2 style={{ marginTop: "0", fontSize: "1.125rem" }}>Details</h2>
              <div style={{ display: "grid", gap: "1rem" }}>
                <div>
                  <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
                    Integration Type
                  </p>
                  <p
                    style={{
                      margin: "0.5rem 0 0 0",
                      fontSize: "1rem",
                      fontWeight: "500",
                    }}
                  >
                    {connection.integrationType.toUpperCase()}
                  </p>
                </div>
                <div>
                  <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
                    Base URL
                  </p>
                  <p
                    style={{
                      margin: "0.5rem 0 0 0",
                      fontSize: "1rem",
                      fontWeight: "500",
                    }}
                  >
                    {connection.baseUrl || "Not configured"}
                  </p>
                </div>
                <div>
                  <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
                    Auth Method
                  </p>
                  <p
                    style={{
                      margin: "0.5rem 0 0 0",
                      fontSize: "1rem",
                      fontWeight: "500",
                    }}
                  >
                    {connection.authMethod.replace(/_/g, " ")}
                  </p>
                </div>
                <div>
                  <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
                    Status
                  </p>
                  <p style={{ margin: "0.5rem 0 0 0" }}>
                    <StatusBadge status={connection.status} />
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                onClick={() => setIsEditing(true)}
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Edit
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConnection.isPending}
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  fontWeight: "500",
                  cursor: "pointer",
                  opacity: deleteConnection.isPending ? 0.6 : 1,
                }}
              >
                {deleteConnection.isPending ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleUpdate}>
            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="name"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: "500",
                  fontSize: "0.875rem",
                }}
              >
                Connection Name
              </label>
              <input
                id="name"
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="baseUrl"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: "500",
                  fontSize: "0.875rem",
                }}
              >
                Base URL
              </label>
              <input
                id="baseUrl"
                type="url"
                value={formData.baseUrl}
                onChange={(e) =>
                  setFormData({ ...formData, baseUrl: e.target.value })
                }
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label
                htmlFor="authMethod"
                style={{
                  display: "block",
                  marginBottom: "0.5rem",
                  fontWeight: "500",
                  fontSize: "0.875rem",
                }}
              >
                Authentication Method
              </label>
              <select
                id="authMethod"
                value={formData.authMethod}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    authMethod: AuthMethodSchema.parse(e.target.value),
                  })
                }
                style={{
                  width: "100%",
                  padding: "0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                }}
              >
                <option value="oauth2">OAuth 2.0</option>
                <option value="api_token">API Token</option>
                <option value="personal_access_token">Personal Access Token</option>
              </select>
            </div>

            <div style={{ display: "flex", gap: "1rem" }}>
              <button
                type="submit"
                disabled={updateConnection.isPending}
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#10b981",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  fontWeight: "500",
                  cursor: "pointer",
                  opacity: updateConnection.isPending ? 0.6 : 1,
                }}
              >
                {updateConnection.isPending ? "Saving..." : "Save Changes"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  setFormData({
                    name: connection.name,
                    baseUrl: connection.baseUrl || "",
                    authMethod: connection.authMethod,
                  });
                }}
                style={{
                  padding: "0.75rem 1.5rem",
                  backgroundColor: "#e5e7eb",
                  color: "#333",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "1rem",
                  fontWeight: "500",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
