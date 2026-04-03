type RunStatusBadgeProps = {
  status: string;
};

const STATUS_STYLES: Record<string, { bgColor: string; textColor: string }> = {
  planning: { bgColor: "#dbeafe", textColor: "#1e40af" },
  executing: { bgColor: "#fef3c7", textColor: "#92400e" },
  completed: { bgColor: "#dcfce7", textColor: "#166534" },
  failed: { bgColor: "#fee2e2", textColor: "#991b1b" },
  cancelled: { bgColor: "#f3f4f6", textColor: "#374151" },
  pending: { bgColor: "#e0e7ff", textColor: "#3730a3" },
  reflecting: { bgColor: "#fae8ff", textColor: "#86198f" },
  delegating: { bgColor: "#f0fdf4", textColor: "#14532d" },
};

const DEFAULT_STYLE = { bgColor: "#f3f4f6", textColor: "#374151" };

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const { bgColor, textColor } = STATUS_STYLES[status] ?? DEFAULT_STYLE;

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
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
