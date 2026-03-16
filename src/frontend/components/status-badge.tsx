import type { ConnectionStatus } from "@shared/schemas/connection.schema";

type StatusBadgeProps = {
  status: ConnectionStatus;
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const styleMap: Record<ConnectionStatus, { bgColor: string; textColor: string }> = {
    connected: { bgColor: "#dcfce7", textColor: "#166534" },
    disconnected: { bgColor: "#f3f4f6", textColor: "#374151" },
    error: { bgColor: "#fee2e2", textColor: "#991b1b" },
    refreshing: { bgColor: "#dbeafe", textColor: "#1e40af" },
  };

  const { bgColor, textColor } = styleMap[status];

  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.25rem 0.75rem",
        borderRadius: "9999px",
        fontSize: "0.875rem",
        fontWeight: "500",
        backgroundColor: bgColor,
        color: textColor,
      }}
    >
      {status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")}
    </span>
  );
}
