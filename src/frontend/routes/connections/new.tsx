import { useNavigate } from "@tanstack/react-router";
import { useCreateConnection } from "@frontend/api/connections.api";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState } from "react";
import { AuthMethodSchema } from "@shared/schemas/connection.schema";

export function NewConnectionPage() {
  const navigate = useNavigate();
  const createConnection = useCreateConnection();
  const [formData, setFormData] = useState<{
    name: string;
    integrationType: "jira" | "github";
    baseUrl: string;
    authMethod: "oauth2" | "api_token" | "personal_access_token";
  }>({
    name: "",
    integrationType: "jira",
    baseUrl: "",
    authMethod: "oauth2",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await createConnection.mutateAsync(formData);
      navigate({ to: "/connections" });
    } catch (err) {
      // Error is displayed by createConnection.error
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: "0", marginBottom: "2rem" }}>New Connection</h1>

      {createConnection.error && (
        <ErrorDisplay
          error={createConnection.error}
          message="Failed to create connection"
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
        <form onSubmit={handleSubmit}>
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
              placeholder="e.g., My Jira Instance"
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
              htmlFor="integrationType"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "500",
                fontSize: "0.875rem",
              }}
            >
              Integration Type
            </label>
            <select
              id="integrationType"
              value={formData.integrationType}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  integrationType: e.target.value as "jira" | "github",
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
              <option value="jira">Jira</option>
              <option value="github">GitHub</option>
            </select>
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
              placeholder="https://example.atlassian.net"
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
              disabled={createConnection.isPending}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: "0.375rem",
                fontSize: "1rem",
                fontWeight: "500",
                cursor: "pointer",
                opacity: createConnection.isPending ? 0.6 : 1,
              }}
            >
              {createConnection.isPending ? "Creating..." : "Create Connection"}
            </button>
            <button
              type="button"
              onClick={() => navigate({ to: "/connections" })}
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
      </div>
    </div>
  );
}
