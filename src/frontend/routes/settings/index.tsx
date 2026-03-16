import {
  useServerSettings,
  useUpdateServerSettings,
} from "@frontend/api/settings.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState, useEffect } from "react";
import {
  TransportModeSchema,
  LogLevelSchema,
} from "@shared/schemas/server.schema";

export function SettingsPage() {
  const { data: settings, isLoading, error } = useServerSettings();
  const updateSettings = useUpdateServerSettings();
  const [formData, setFormData] = useState(
    settings || {
      transportMode: "stdio" as const,
      logLevel: "info" as const,
      adminPort: 3000,
      enableCors: false,
      rateLimitRpm: 600,
    }
  );

  useEffect(() => {
    if (settings) {
      setFormData(settings);
    }
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await updateSettings.mutateAsync(formData);
    } catch (err) {
      // Error is displayed by updateSettings.error
    }
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading settings..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} message="Failed to load settings" />;
  }

  return (
    <div>
      <h1 style={{ marginTop: "0", marginBottom: "2rem" }}>Settings</h1>

      {updateSettings.error && (
        <ErrorDisplay
          error={updateSettings.error}
          message="Failed to update settings"
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
              htmlFor="transportMode"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "500",
                fontSize: "0.875rem",
              }}
            >
              Transport Mode
            </label>
            <select
              id="transportMode"
              value={formData.transportMode}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  transportMode: TransportModeSchema.parse(e.target.value),
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
              <option value="stdio">Standard I/O</option>
              <option value="sse">Server-Sent Events</option>
              <option value="http">HTTP</option>
            </select>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label
              htmlFor="logLevel"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "500",
                fontSize: "0.875rem",
              }}
            >
              Log Level
            </label>
            <select
              id="logLevel"
              value={formData.logLevel}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  logLevel: LogLevelSchema.parse(e.target.value),
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
              <option value="trace">Trace</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warn</option>
              <option value="error">Error</option>
              <option value="fatal">Fatal</option>
            </select>
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label
              htmlFor="adminPort"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "500",
                fontSize: "0.875rem",
              }}
            >
              Admin Port
            </label>
            <input
              id="adminPort"
              type="number"
              value={formData.adminPort}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  adminPort: parseInt(e.target.value, 10),
                })
              }
              min="1"
              max="65535"
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
              htmlFor="rateLimitRpm"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "500",
                fontSize: "0.875rem",
              }}
            >
              Rate Limit (requests per minute)
            </label>
            <input
              id="rateLimitRpm"
              type="number"
              value={formData.rateLimitRpm}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  rateLimitRpm: parseInt(e.target.value, 10),
                })
              }
              min="1"
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
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={formData.enableCors}
                onChange={(e) =>
                  setFormData({ ...formData, enableCors: e.target.checked })
                }
                style={{ cursor: "pointer" }}
              />
              <span style={{ fontWeight: "500" }}>Enable CORS</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={updateSettings.isPending}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "1rem",
              fontWeight: "500",
              cursor: "pointer",
              opacity: updateSettings.isPending ? 0.6 : 1,
            }}
          >
            {updateSettings.isPending ? "Saving..." : "Save Settings"}
          </button>
        </form>
      </div>
    </div>
  );
}
