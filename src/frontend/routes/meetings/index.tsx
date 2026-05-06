import { Link } from "@tanstack/react-router";
import { useMeetingTranscripts, useMeetingTranscriptStats } from "@frontend/api/meetings.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: "1.5rem", fontWeight: "700", color: "#1f2937", lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{sub}</span>}
    </div>
  );
}

export function MeetingsPage() {
  const { data: transcripts, isLoading, error } = useMeetingTranscripts();
  const { data: stats } = useMeetingTranscriptStats();

  if (isLoading) return <LoadingSpinner message="Loading transcripts..." />;
  if (error) return <ErrorDisplay error={error} message="Failed to load transcripts" />;

  const totalHours = stats ? Math.round(stats.totalDurationSeconds / 3600 * 10) / 10 : 0;

  return (
    <div>
      <h1 style={{ marginTop: "0", marginBottom: "0.5rem" }}>Meeting Transcriptions</h1>
      <p style={{ color: "#6b7280", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
        Audio captured via Chrome extension, transcribed locally with Whisper
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="Total Meetings" value={stats?.totalTranscripts ?? 0} />
        <StatCard label="Total Hours" value={totalHours} sub="of audio transcribed" />
        <StatCard label="Transcripts" value={transcripts?.length ?? 0} sub="in database" />
      </div>

      {/* Empty state */}
      {(!transcripts || transcripts.length === 0) ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#9ca3af", backgroundColor: "#fff", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}>
          <p style={{ fontSize: "1.1rem", fontWeight: "500", marginBottom: "0.5rem" }}>No transcripts yet</p>
          <p style={{ fontSize: "0.875rem" }}>
            Install the Chrome extension, join a meeting, and click &quot;Start Recording&quot; to capture your first transcript.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {transcripts.map((t) => (
            <Link
              key={t.id}
              to="/meetings/$transcriptId"
              params={{ transcriptId: t.id }}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div style={{
                backgroundColor: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: "0.5rem",
                padding: "1rem 1.25rem",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                cursor: "pointer",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#3b82f6"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#e5e7eb"; }}
              >
                <div>
                  <div style={{ fontWeight: "600", fontSize: "0.95rem", marginBottom: "0.25rem" }}>
                    {t.meetingTitle || "Untitled Meeting"}
                  </div>
                  <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                    {fmtDate(t.startTime)} &middot; {fmtDuration(t.durationSeconds)} &middot; {t.segmentCount} segments &middot; {t.language.toUpperCase()}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <span style={{
                    fontSize: "0.65rem",
                    padding: "0.2rem 0.5rem",
                    backgroundColor: "#eff6ff",
                    color: "#3b82f6",
                    borderRadius: "9999px",
                    fontWeight: "500",
                  }}>
                    {t.whisperModel}
                  </span>
                  <span style={{ color: "#9ca3af", fontSize: "1.2rem" }}>&rsaquo;</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
