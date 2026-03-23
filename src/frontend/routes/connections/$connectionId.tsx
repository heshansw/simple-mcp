import { useParams, useNavigate } from "@tanstack/react-router";
import {
  useConnection,
  useUpdateConnection,
  useDeleteConnection,
  useCredentialStatus,
  useStoreCredentials,
  useRemoveCredentials,
  useTestConnection,
} from "@frontend/api/connections.api";
import { StatusBadge } from "@frontend/components/status-badge";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState, useEffect } from "react";
import { AuthMethodSchema } from "@shared/schemas/connection.schema";

export function ConnectionDetailPage() {
  const { connectionId } = useParams({ from: "/connections/$connectionId" });
  const navigate = useNavigate();
  const { data: connection, isLoading, error } = useConnection(connectionId);
  const { data: credStatus } = useCredentialStatus(connectionId);
  const updateConnection = useUpdateConnection();
  const deleteConnection = useDeleteConnection();
  const storeCredentials = useStoreCredentials();
  const removeCredentials = useRemoveCredentials();
  const testConnection = useTestConnection();
  const [isEditing, setIsEditing] = useState(false);
  const [token, setToken] = useState("");
  const [jiraEmail, setJiraEmail] = useState("");
  const [jiraApiToken, setJiraApiToken] = useState("");
  const [tokenSaved, setTokenSaved] = useState(false);
  const [formData, setFormData] = useState(
    connection ? {
      name: connection.name,
      baseUrl: connection.baseUrl || "",
      authMethod: connection.authMethod,
    } : { name: "", baseUrl: "", authMethod: "oauth2" as const }
  );

  useEffect(() => {
    if (connection) {
      setFormData({
        name: connection.name,
        baseUrl: connection.baseUrl || "",
        authMethod: connection.authMethod,
      });
    }
  }, [connection]);

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

  const isJira = connection?.integrationType === "jira";

  const handleSaveToken = async (e: React.FormEvent) => {
    e.preventDefault();

    let credentialValue: string;
    if (isJira) {
      if (!jiraEmail.trim() || !jiraApiToken.trim()) return;
      // Store Jira credentials as JSON: { email, apiToken }
      credentialValue = JSON.stringify({
        email: jiraEmail.trim(),
        apiToken: jiraApiToken.trim(),
      });
    } else {
      if (!token.trim()) return;
      credentialValue = token.trim();
    }

    try {
      await storeCredentials.mutateAsync({
        connectionId: connection.id,
        token: credentialValue,
      });
      setToken("");
      setJiraEmail("");
      setJiraApiToken("");
      setTokenSaved(true);
      setTimeout(() => setTokenSaved(false), 3000);
    } catch (err) {
      // Error displayed by storeCredentials.error
    }
  };

  const handleRemoveToken = async () => {
    if (!confirm("Remove stored credentials? The connection will be disconnected.")) return;
    try {
      await removeCredentials.mutateAsync(connection.id);
    } catch (err) {
      // Error handled
    }
  };

  const handleTestConnection = async () => {
    try {
      await testConnection.mutateAsync(connection.id);
    } catch (err) {
      // Error handled
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

      {storeCredentials.error && (
        <ErrorDisplay
          error={storeCredentials.error}
          message="Failed to save credentials"
        />
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: "600px" }}>
        {/* Connection Details Card */}
        <div
          style={{
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
                    <p style={{ margin: "0.5rem 0 0 0", fontSize: "1rem", fontWeight: "500" }}>
                      {connection.integrationType.toUpperCase()}
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>Base URL</p>
                    <p style={{ margin: "0.5rem 0 0 0", fontSize: "1rem", fontWeight: "500" }}>
                      {connection.baseUrl || "Not configured"}
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>Auth Method</p>
                    <p style={{ margin: "0.5rem 0 0 0", fontSize: "1rem", fontWeight: "500" }}>
                      {connection.authMethod.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div>
                    <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>Status</p>
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
                  onClick={handleTestConnection}
                  disabled={testConnection.isPending}
                  style={{
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#8b5cf6",
                    color: "#fff",
                    border: "none",
                    borderRadius: "0.375rem",
                    fontSize: "1rem",
                    fontWeight: "500",
                    cursor: "pointer",
                    opacity: testConnection.isPending ? 0.6 : 1,
                  }}
                >
                  {testConnection.isPending ? "Testing..." : "Test Connection"}
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
                <label htmlFor="name" style={labelStyle}>Connection Name</label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  style={inputStyle}
                />
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <label htmlFor="baseUrl" style={labelStyle}>Base URL</label>
                <input
                  id="baseUrl"
                  type="url"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
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

        {/* Credentials / Access Token Card */}
        <div
          style={{
            padding: "2rem",
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ marginTop: "0", fontSize: "1.125rem", marginBottom: "1rem" }}>
            Credentials / Access Token
          </h2>

          {credStatus?.hasCredentials ? (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "1rem",
                  backgroundColor: "#ecfdf5",
                  borderRadius: "0.375rem",
                  marginBottom: "1rem",
                  border: "1px solid #a7f3d0",
                }}
              >
                <span style={{ color: "#059669", fontWeight: "500" }}>
                  Access token is configured
                </span>
              </div>
              <div style={{ display: "flex", gap: "1rem" }}>
                <button
                  onClick={handleRemoveToken}
                  disabled={removeCredentials.isPending}
                  style={{
                    padding: "0.5rem 1rem",
                    backgroundColor: "#ef4444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "0.375rem",
                    fontSize: "0.875rem",
                    cursor: "pointer",
                    opacity: removeCredentials.isPending ? 0.6 : 1,
                  }}
                >
                  {removeCredentials.isPending ? "Removing..." : "Remove Token"}
                </button>
              </div>

              {/* Replace existing credentials */}
              <form onSubmit={handleSaveToken} style={{ marginTop: "1rem" }}>
                <label style={labelStyle}>
                  Replace with new credentials
                </label>
                {isJira ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    <input
                      id="replaceJiraEmail"
                      type="email"
                      value={jiraEmail}
                      onChange={(e) => setJiraEmail(e.target.value)}
                      placeholder="Atlassian account email"
                      style={inputStyle}
                    />
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        id="replaceJiraApiToken"
                        type="password"
                        value={jiraApiToken}
                        onChange={(e) => setJiraApiToken(e.target.value)}
                        placeholder="Jira API token"
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        type="submit"
                        disabled={storeCredentials.isPending || !jiraEmail.trim() || !jiraApiToken.trim()}
                        style={{
                          padding: "0.5rem 1rem",
                          backgroundColor: "#3b82f6",
                          color: "#fff",
                          border: "none",
                          borderRadius: "0.375rem",
                          fontSize: "0.875rem",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          opacity: storeCredentials.isPending || !jiraEmail.trim() || !jiraApiToken.trim() ? 0.6 : 1,
                        }}
                      >
                        {storeCredentials.isPending ? "Saving..." : "Update"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      id="replaceToken"
                      type="password"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      placeholder="Paste new access token..."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      type="submit"
                      disabled={storeCredentials.isPending || !token.trim()}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "#3b82f6",
                        color: "#fff",
                        border: "none",
                        borderRadius: "0.375rem",
                        fontSize: "0.875rem",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        opacity: storeCredentials.isPending || !token.trim() ? 0.6 : 1,
                      }}
                    >
                      {storeCredentials.isPending ? "Saving..." : "Update"}
                    </button>
                  </div>
                )}
              </form>
            </div>
          ) : (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "1rem",
                  backgroundColor: "#fef3c7",
                  borderRadius: "0.375rem",
                  marginBottom: "1rem",
                  border: "1px solid #fcd34d",
                }}
              >
                <span style={{ color: "#d97706", fontWeight: "500" }}>
                  No access token configured — connection is disconnected
                </span>
              </div>

              <form onSubmit={handleSaveToken}>
                {isJira ? (
                  <>
                    <label style={labelStyle}>Jira Cloud Credentials</label>
                    <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8rem", color: "#666" }}>
                      Enter your Atlassian account email and an API token generated at{" "}
                      <a
                        href="https://id.atlassian.com/manage-profile/security/api-tokens"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Atlassian API Tokens
                      </a>
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      <input
                        id="newJiraEmail"
                        type="email"
                        value={jiraEmail}
                        onChange={(e) => setJiraEmail(e.target.value)}
                        placeholder="you@company.com"
                        required
                        style={inputStyle}
                      />
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <input
                          id="newJiraApiToken"
                          type="password"
                          value={jiraApiToken}
                          onChange={(e) => setJiraApiToken(e.target.value)}
                          placeholder="Jira API token"
                          required
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button
                          type="submit"
                          disabled={storeCredentials.isPending || !jiraEmail.trim() || !jiraApiToken.trim()}
                          style={{
                            padding: "0.5rem 1rem",
                            backgroundColor: "#10b981",
                            color: "#fff",
                            border: "none",
                            borderRadius: "0.375rem",
                            fontSize: "0.875rem",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                            opacity: storeCredentials.isPending || !jiraEmail.trim() || !jiraApiToken.trim() ? 0.6 : 1,
                          }}
                        >
                          {storeCredentials.isPending ? "Saving..." : "Save Credentials"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <label htmlFor="newToken" style={labelStyle}>
                      {connection.authMethod === "personal_access_token"
                        ? "Personal Access Token"
                        : connection.authMethod === "api_token"
                        ? "API Token"
                        : "Access Token"}
                    </label>
                    <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.8rem", color: "#666" }}>
                      {connection.integrationType === "github"
                        ? "Generate at GitHub > Settings > Developer settings > Personal access tokens"
                        : "Enter your access token for this integration"}
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <input
                        id="newToken"
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Paste your access token here..."
                        required
                        style={{ ...inputStyle, flex: 1 }}
                      />
                      <button
                        type="submit"
                        disabled={storeCredentials.isPending || !token.trim()}
                        style={{
                          padding: "0.5rem 1rem",
                          backgroundColor: "#10b981",
                          color: "#fff",
                          border: "none",
                          borderRadius: "0.375rem",
                          fontSize: "0.875rem",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                          opacity: storeCredentials.isPending || !token.trim() ? 0.6 : 1,
                        }}
                      >
                        {storeCredentials.isPending ? "Saving..." : "Save Token"}
                      </button>
                    </div>
                  </>
                )}
              </form>
            </div>
          )}

          {tokenSaved && (
            <div
              style={{
                marginTop: "1rem",
                padding: "0.75rem",
                backgroundColor: "#ecfdf5",
                borderRadius: "0.375rem",
                color: "#059669",
                fontSize: "0.875rem",
                border: "1px solid #a7f3d0",
              }}
            >
              Token saved and connection marked as connected.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
