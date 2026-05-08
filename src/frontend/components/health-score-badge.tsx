export type HealthScoreBadgeProps = {
  score: number;
  grade: string;
  size?: number;
};

export function HealthScoreBadge({ score, grade, size = 48 }: HealthScoreBadgeProps) {
  const color = gradeColor(grade);
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 10) * circumference;

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={3} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={`${progress} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fontSize={size * 0.3} fontWeight="700" fill={color}>
          {grade}
        </text>
      </svg>
      <span style={{ fontSize: "0.875rem", fontWeight: "600", color }}>{score.toFixed(1)}</span>
    </div>
  );
}

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#16a34a";
    case "B": return "#65a30d";
    case "C": return "#ca8a04";
    case "D": return "#ea580c";
    case "F": return "#dc2626";
    default: return "#6b7280";
  }
}
