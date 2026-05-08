import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TrendsInputSchema, scoreToGrade } from "@shared/schemas/code-health.schema.js";
import type { HealthTrendReport, TrendDataPoint } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthSnapshotsRepository, CodeHealthSnapshot } from "../../db/repositories/code-health-snapshots.repository.js";

export type TrendsToolDeps = {
  snapshotsRepo: CodeHealthSnapshotsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

const PERIOD_DAYS: Record<string, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "all": null,
} as const;

function startOfDay(date: Date): string {
  return date.toISOString().split("T")[0] as string;
}

function getWeekKey(date: Date): string {
  // ISO week: use the Monday of the week
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return startOfDay(d);
}

function getMonthKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function groupKey(date: Date, granularity: "daily" | "weekly" | "monthly"): string {
  switch (granularity) {
    case "daily":
      return startOfDay(date);
    case "weekly":
      return getWeekKey(date);
    case "monthly":
      return getMonthKey(date);
    default: {
      const _exhaustive: never = granularity;
      return _exhaustive;
    }
  }
}

export function registerTrendsTool(server: McpServer, deps: TrendsToolDeps): void {
  server.tool(
    "code_health_trends",
    "Query historical code health metrics over time. Returns time-series data points, trend direction, and rate of change.",
    TrendsInputSchema.shape,
    async (args) => {
      try {
        const input = TrendsInputSchema.parse(args);
        const { targetPath, period, granularity } = input;

        deps.logger.info("Querying code health trends", { targetPath, period, granularity });

        // 1. Fetch all snapshots for this directory
        const allSnapshots = await deps.snapshotsRepo.findByDirectory(targetPath, 1000);

        if (allSnapshots.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                targetPath,
                period,
                dataPoints: [],
                trendDirection: "stable",
                rateOfChange: 0,
                currentScore: undefined,
                previousScore: undefined,
              } satisfies HealthTrendReport, null, 2),
            }],
          };
        }

        // 2. Filter by period
        const periodDays = PERIOD_DAYS[period] ?? null;
        const cutoff = periodDays !== null
          ? new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
          : null;

        const filteredSnapshots = cutoff
          ? allSnapshots.filter((s) => new Date(s.createdAt) >= cutoff)
          : allSnapshots;

        if (filteredSnapshots.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                targetPath,
                period,
                dataPoints: [],
                trendDirection: "stable",
                rateOfChange: 0,
                currentScore: allSnapshots[0]?.overallScore,
                previousScore: undefined,
              } satisfies HealthTrendReport, null, 2),
            }],
          };
        }

        // 3. Sort oldest-first for aggregation
        const sorted = [...filteredSnapshots].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );

        // 4. Group by granularity — take the latest snapshot per bucket
        const buckets = new Map<string, CodeHealthSnapshot>();
        for (const snapshot of sorted) {
          const key = groupKey(new Date(snapshot.createdAt), granularity);
          buckets.set(key, snapshot);
        }

        // 5. Build data points sorted chronologically
        const dataPoints: TrendDataPoint[] = [...buckets.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, snapshot]) => ({
            date,
            score: snapshot.overallScore,
            grade: scoreToGrade(snapshot.overallScore),
            fileCount: snapshot.fileCount,
          }));

        // 6. Compute trend direction and rate of change
        const firstPoint = dataPoints[0];
        const lastPoint = dataPoints[dataPoints.length - 1];

        let trendDirection: "improving" | "declining" | "stable" = "stable";
        let rateOfChange = 0;

        if (firstPoint && lastPoint && dataPoints.length > 1) {
          const delta = lastPoint.score - firstPoint.score;

          if (delta > 0.3) {
            trendDirection = "improving";
          } else if (delta < -0.3) {
            trendDirection = "declining";
          }

          const periodCount = dataPoints.length - 1;
          rateOfChange = periodCount > 0 ? delta / periodCount : 0;
        }

        const trendReport: HealthTrendReport = {
          targetPath,
          period,
          dataPoints,
          trendDirection,
          rateOfChange: Math.round(rateOfChange * 1000) / 1000,
          currentScore: lastPoint?.score,
          previousScore: dataPoints.length > 1 ? dataPoints[dataPoints.length - 2]?.score : undefined,
        };

        deps.logger.info("Trends query complete", {
          targetPath,
          dataPointCount: dataPoints.length,
          trendDirection,
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(trendReport, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
