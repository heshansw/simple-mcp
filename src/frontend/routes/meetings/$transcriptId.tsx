import { useParams, useNavigate } from "@tanstack/react-router";
import { useMeetingTranscript } from "@frontend/api/meetings.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState } from "react";

function fmtDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

export function MeetingDetailPage() {
  const { transcriptId } = useParams({ from: "/meetings/$transcriptId" });
  const navigate = useNavigate();
  const { data: transcript, isLoading, error } = useMeetingTranscript(transcriptId);
  const [activeTab, setActiveTab] = useState<"transcript" | "analyses">("transcript");

  if (isLoading) return <LoadingSpinner message="Loading transcript..." />;
  if (error || !transcript) return <ErrorDisplay error={error} message="Failed to load transcript" />;

  const tabStyle = (isActive: boolean) => ({
    padding: "0.5rem 1rem",
    border: "none",
    borderBottom: isActive ? "2px solid #3b82f6" : "2px solid transparent",
    background: "none",
    color: isActive ? "#3b82f6" : "#6b7280",
    fontWeight: isActive ? "600" : "400" as const,
    cursor: "pointer",
    fontSize: "0.875rem",
  });

  return (
    <div>
      {/* Back link */}
      <button
        onClick={() => navigate({ to: "/meetings" })}
        style={{ background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: "0.875rem", marginBottom: "1rem", padding: 0 }}
      >
        &larr; Back to Meetings
      </button>

      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ marginTop: "0", marginBottom: "0.5rem" }}>
          {transcript.meetingTitle || "Untitled Meeting"}
        </h1>
        <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "#6b7280", flexWrap: "wrap" }}>
          <span>{new Date(transcript.startTime).toLocaleString()}</span>
          <span>&middot;</span>
          <span>{fmtDuration(transcript.durationSeconds)}</span>
          <span>&middot;</span>
          <span>{transcript.segmentCount} segments</span>
          <span>&middot;</span>
          <span>{transcript.language.toUpperCase()}</span>
          <span>&middot;</span>
          <span style={{
            padding: "0.1rem 0.4rem",
            backgroundColor: "#eff6ff",
            color: "#3b82f6",
            borderRadius: "9999px",
            fontSize: "0.7rem",
            fontWeight: "500",
          }}>
            {transcript.whisperModel}
          </span>
        </div>
        {transcript.meetingUrl && (
          <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>
            {transcript.meetingUrl}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e5e7eb", marginBottom: "1.5rem" }}>
        <button style={tabStyle(activeTab === "transcript")} onClick={() => setActiveTab("transcript")}>
          Transcript
        </button>
        <button style={tabStyle(activeTab === "analyses")} onClick={() => setActiveTab("analyses")}>
          Analyses
        </button>
      </div>

      {/* Tab content */}
      {activeTab === "transcript" ? (
        <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1.5rem" }}>
          {transcript.content.segments.length > 0 ? (
            <div style={{ fontFamily: "monospace", fontSize: "0.8rem", lineHeight: "1.8" }}>
              {transcript.content.segments.map((seg, i) => (
                <div key={i} style={{ marginBottom: "0.5rem" }}>
                  <span style={{ color: "#9ca3af", marginRight: "0.75rem", userSelect: "none" }}>
                    {seg.startTime}
                  </span>
                  <span>{seg.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "#9ca3af" }}>No segments available. Full text:</p>
          )}
          {!transcript.content.segments.length && transcript.content.fullText && (
            <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.85rem", lineHeight: "1.6" }}>
              {transcript.content.fullText}
            </pre>
          )}
        </div>
      ) : (
        <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1.5rem" }}>
          <p style={{ color: "#9ca3af", textAlign: "center", padding: "2rem 0" }}>
            No analyses yet. Use the MCP tool <code>audio_analyze_transcript</code> to generate a summary,
            extract action items, or cross-reference with Jira/GitHub.
          </p>
        </div>
      )}
    </div>
  );
}
