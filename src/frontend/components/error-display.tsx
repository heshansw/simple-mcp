type ErrorDisplayProps = {
  error: Error | null;
  message?: string;
};

export function ErrorDisplay({ error, message }: ErrorDisplayProps) {
  if (!error) {
    return null;
  }

  const displayMessage = message || error.message || "An unexpected error occurred";

  return (
    <div
      style={{
        padding: "1rem",
        marginBottom: "1rem",
        backgroundColor: "#fee2e2",
        borderLeft: "4px solid #dc2626",
        borderRadius: "0.375rem",
        color: "#991b1b",
      }}
    >
      <p style={{ margin: "0.5rem 0", fontWeight: "600" }}>Error</p>
      <p style={{ margin: "0.25rem 0" }}>{displayMessage}</p>
    </div>
  );
}
