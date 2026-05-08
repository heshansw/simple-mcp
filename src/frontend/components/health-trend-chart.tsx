export type HealthTrendChartProps = {
  dataPoints: Array<{ date: string; score: number }>;
  width?: number;
  height?: number;
};

export function HealthTrendChart({ dataPoints, width = 300, height = 80 }: HealthTrendChartProps) {
  if (dataPoints.length < 2) {
    return <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: "0.75rem" }}>Not enough data</div>;
  }

  const padding = 4;
  const chartW = width - padding * 2;
  const chartH = height - padding * 2;
  const minScore = Math.min(...dataPoints.map(d => d.score));
  const maxScore = Math.max(...dataPoints.map(d => d.score));
  const range = maxScore - minScore || 1;

  const points = dataPoints.map((d, i) => {
    const x = padding + (i / (dataPoints.length - 1)) * chartW;
    const y = padding + chartH - ((d.score - minScore) / range) * chartH;
    return `${x},${y}`;
  });

  const lastPoint = dataPoints[dataPoints.length - 1];
  const firstPoint = dataPoints[0];
  const trending = lastPoint && firstPoint ? (lastPoint.score >= firstPoint.score ? "#16a34a" : "#dc2626") : "#6b7280";

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polyline fill="none" stroke={trending} strokeWidth={2} strokeLinejoin="round" points={points.join(" ")} />
      {lastPoint && (
        <circle cx={parseFloat(points[points.length - 1]?.split(",")[0] ?? "0")} cy={parseFloat(points[points.length - 1]?.split(",")[1] ?? "0")} r={3} fill={trending} />
      )}
    </svg>
  );
}
