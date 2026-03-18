import { useNavigate } from "@tanstack/react-router";
import { useCreateConnection, useStoreCredentials } from "@frontend/api/connections.api";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState } from "react";
import { AuthMethodSchema } from "@shared/schemas/connection.schema";

export function NewConnectionPage() {
  const navigate = useNavigate();
  const createConnection = useCreateConnection();
  const storeCredentials = useStoreCredentials();
  const [formData, setFormData] = useState<{
    name: string;
    integrationType: "jira" | "github";
    baseUrl: string;
    authMethod: "oauth2" | "api_token" | "personal_access_token";
    accessToken: string;
  }>({
    name: "",
    integrationType: "jira",
    baseUrl: "",
    authMethod: "api_token",
    accessToken: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const { accessToken, ...connectionData } = formData;
      const created = await createConnection.mutateAsync(connectionData);

      // If an access token was provided, store it and mark as connected
      if (accessToken.trim()) {
        await storeCredentials.mutateAsync({
          connectionId: created.id,
          token: accessToken.trim(),
        });
      }

      navigate({ to: "/connections" });
    } catch (err) {
      // Error is displayed by createConnection.error
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "0.5rem",
    border: "1px solid #d1d5db",
    borderRadius: "0.375rem",
    fontSize: "1rem",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block" as const,
    marginBottom: "0.5rem",
    fontWeight: "500",
    fontSize: "0.875rem",
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

      {storeCredentials.error && (
        <ErrorDisplay
          error={storeCredentials.error}
          message="Failed to save access token"
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
            <label htmlFor="name" style={labelStyle}>Connection Name</label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., My Jira Instance"
              required
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="integrationType" style={labelStyle}>Integration Type</label>
            <select
              id="integrationType"
              value={formData.integrationType}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  integrationType: e.target.value as "jira" | "github",
                })
              }
              style={inputStyle}
            >
              <option value="jira">Jira</option>
              <option value="github">GitHub</option>
            </select>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="baseUrl" style={labelStyle}>Base URL</label>
            <input
              id="baseUrl"
              type="url"
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              placeholder={
                formData.integrationType === "jira"
                  ? "https://your-org.atlassian.net"
                  : "https://api.github.com"
              }
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="authMethod" style={labelStyle}>Authentication Method</label>
            <select
              id="authMethod"
              value={formData.authMethod}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  authMethod: AuthMethodSchema.parse(e.target.value),
                })
              }
              style={inputStyle}
            >
              <option value="api_token">API Token</option>
              <option value="personal_access_token">Personal Access Token</option>
              <option value="oauth2">OAuth 2.0</option>
            </select>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label htmlFor="accessToken" style={labelStyle}>
              Access Token {" "}
              <span style={{ fontWeight: "400", color: "#999" }}>(optional — can add later)</span>
            </label>
            <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.8rem", color: "#666" }}>
              {formData.integrationType === "jira"
                ? "Generate at Atlassian Account > Security > API Tokens"
                : "Generate at GitHub > Settings > Developer settings > Personal access tokens"}
            </p>
            <input
              id="accessToken"
              type="password"
              value={formData.accessToken}
              onChange={(e) => setFormData({ ...formData, accessToken: e.target.value })}
              placeholder="Paste your access token here..."
              style={inputStyle}
            />
          </div>

          <div style={{ display: "flex", gap: "1rem" }}>
            <button
              type="submit"
              disabled={createConnection.isPending || storeCredentials.isPending}
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
              {createConnection.isPending || storeCredentials.isPending
                ? "Creating..."
                : "Create Connection"}
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
