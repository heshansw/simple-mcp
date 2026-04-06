import type { AgentRunStepItem } from "@frontend/api/agent-executions.api";

type TokenUsageChartProps = {
  steps: AgentRunStepItem[];
};

export function TokenUsageChart({ steps }: TokenUsageChartProps) {
  const stepsWithTokens = steps.filter((s) => s.inputTokens > 0 || s.outputTokens > 0);

  if (stepsWithTokens.length === 0) {
    return (
      <div style={{ padding: "1.5rem", color: "#9ca3af", textAlign: "center" }}>
        No token usage data available.
      </div>
    );
  }

  // Calculate cumulative totals
  let cumulativeInput = 0;
  let cumulativeOutput = 0;
  const dataPoints = stepsWithTokens.map((step) => {
    cumulativeInput += step.inputTokens;
    cumulativeOutput += step.outputTokens;
    return {
      stepIndex: step.stepIndex,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      cumulativeInput,
      cumulativeOutput,
      cumulativeTotal: cumulativeInput + cumulativeOutput,
    };
  });

  const maxTotal = dataPoints[dataPoints.length - 1]?.cumulativeTotal ?? 1;
  const maxPerStep = Math.max(...stepsWithTokens.map((s) => s.inputTokens + s.outputTokens), 1);

  const chartWidth = 600;
  const chartHeight = 200;
  const barWidth = Math.min(30, (chartWidth - 40) / dataPoints.length - 2);
  const padding = { top: 20, right: 20, bottom: 30, left: 60 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  return (
    <div>
      {/* Summary */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          marginBottom: "1rem",
          fontSize: "0.8125rem",
        }}
      >
        <div>
          <span style={{ color: "#6b7280" }}>Total Input: </span>
          <span style={{ fontWeight: "600", color: "#3b82f6" }}>
            {cumulativeInput.toLocaleString()}
          </span>
        </div>
        <div>
          <span style={{ color: "#6b7280" }}>Total Output: </span>
          <span style={{ fontWeight: "600", color: "#10b981" }}>
            {cumulativeOutput.toLocaleString()}
          </span>
        </div>
        <div>
          <span style={{ color: "#6b7280" }}>Combined: </span>
          <span style={{ fontWeight: "600", color: "#111827" }}>
            {(cumulativeInput + cumulativeOutput).toLocaleString()}
          </span>
        </div>
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        style={{ width: "100%", maxWidth: `${chartWidth}px`, height: "auto" }}
      >
        {/* Y-axis labels */}
        <text
          x={padding.left - 8}
          y={padding.top + 4}
          textAnchor="end"
          style={{ fontSize: "9px", fill: "#9ca3af" }}
        >
          {formatTokenCount(maxPerStep)}
        </text>
        <text
          x={padding.left - 8}
          y={padding.top + innerHeight}
          textAnchor="end"
          style={{ fontSize: "9px", fill: "#9ca3af" }}
        >
          0
        </text>

        {/* Grid lines */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left + innerWidth}
          y2={padding.top}
          stroke="#f3f4f6"
          strokeWidth="1"
        />
        <line
          x1={padding.left}
          y1={padding.top + innerHeight / 2}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight / 2}
          stroke="#f3f4f6"
          strokeWidth="1"
        />
        <line
          x1={padding.left}
          y1={padding.top + innerHeight}
          x2={padding.left + innerWidth}
          y2={padding.top + innerHeight}
          stroke="#e5e7eb"
          strokeWidth="1"
        />

        {/* Bars */}
        {dataPoints.map((dp, i) => {
          const x = padding.left + (i * innerWidth) / dataPoints.length + 1;
          const inputHeight = (dp.inputTokens / maxPerStep) * innerHeight;
          const outputHeight = (dp.outputTokens / maxPerStep) * innerHeight;

          return (
            <g key={dp.stepIndex}>
              {/* Input tokens bar */}
              <rect
                x={x}
                y={padding.top + innerHeight - inputHeight - outputHeight}
                width={barWidth}
                height={inputHeight}
                fill="#3b82f6"
                rx="1"
              >
                <title>Step {dp.stepIndex}: {dp.inputTokens} input tokens</title>
              </rect>
              {/* Output tokens bar (stacked) */}
              <rect
                x={x}
                y={padding.top + innerHeight - outputHeight}
                width={barWidth}
                height={outputHeight}
                fill="#10b981"
                rx="1"
              >
                <title>Step {dp.stepIndex}: {dp.outputTokens} output tokens</title>
              </rect>
            </g>
          );
        })}

        {/* Cumulative line */}
        <polyline
          points={dataPoints
            .map((dp, i) => {
              const x =
                padding.left +
                (i * innerWidth) / dataPoints.length +
                barWidth / 2;
              const y =
                padding.top +
                innerHeight -
                (dp.cumulativeTotal / maxTotal) * innerHeight * 0.8;
              return `${x},${y}`;
            })
            .join(" ")}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeDasharray="4 2"
        />

        {/* Legend */}
        <rect x={padding.left} y={chartHeight - 12} width="8" height="8" fill="#3b82f6" rx="1" />
        <text x={padding.left + 12} y={chartHeight - 4} style={{ fontSize: "8px", fill: "#6b7280" }}>
          Input
        </text>
        <rect x={padding.left + 50} y={chartHeight - 12} width="8" height="8" fill="#10b981" rx="1" />
        <text x={padding.left + 62} y={chartHeight - 4} style={{ fontSize: "8px", fill: "#6b7280" }}>
          Output
        </text>
        <line
          x1={padding.left + 110}
          y1={chartHeight - 8}
          x2={padding.left + 125}
          y2={chartHeight - 8}
          stroke="#f59e0b"
          strokeWidth="1.5"
          strokeDasharray="4 2"
        />
        <text x={padding.left + 130} y={chartHeight - 4} style={{ fontSize: "8px", fill: "#6b7280" }}>
          Cumulative
        </text>
      </svg>
    </div>
  );
}

function formatTokenCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}
