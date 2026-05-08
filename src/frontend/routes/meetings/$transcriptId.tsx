import { useParams, useNavigate } from "@tanstack/react-router";
import {
  useMeetingTranscript,
  useMeetingAnalyses,
  useResummarize,
} from "@frontend/api/meetings.api";
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
  const { data: analysesData, isLoading: analysesLoading } = useMeetingAnalyses(transcriptId);
  const resummarize = useResummarize(transcriptId);
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
                  {seg.speaker && (
                    <span style={{ color: "#3b82f6", fontWeight: 600, marginRight: "0.5rem" }}>
                      {seg.speaker}:
                    </span>
                  )}
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
        <div>
          {/* Re-summarize button */}
          <div style={{ marginBottom: "1rem", display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={() => resummarize.mutate()}
              disabled={resummarize.isPending}
              style={{
                padding: "0.4rem 0.8rem",
                fontSize: "0.8rem",
                backgroundColor: resummarize.isPending ? "#9ca3af" : "#3b82f6",
                color: "#fff",
                border: "none",
                borderRadius: "0.375rem",
                cursor: resummarize.isPending ? "not-allowed" : "pointer",
              }}
            >
              {resummarize.isPending ? "Requesting..." : "Re-summarize"}
            </button>
          </div>

          {analysesLoading ? (
            <LoadingSpinner message="Loading analyses..." />
          ) : !analysesData || analysesData.status === "not_found" || analysesData.analyses.length === 0 ? (
            <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1.5rem" }}>
              <div style={{ textAlign: "center", padding: "2rem 0" }}>
                <p style={{ color: "#6b7280", fontSize: "0.95rem", fontWeight: "500", marginBottom: "0.5rem" }}>
                  Summary is being generated...
                </p>
                <p style={{ color: "#9ca3af", fontSize: "0.8rem" }}>
                  The meeting is being summarized in the background using Claude CLI.
                  This page auto-refreshes every 15 seconds. You can also click &quot;Re-summarize&quot; to trigger it manually.
                </p>
                <div style={{ marginTop: "1rem" }}>
                  <div style={{
                    display: "inline-block",
                    width: "1.5rem",
                    height: "1.5rem",
                    border: "2px solid #e5e7eb",
                    borderTopColor: "#3b82f6",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {analysesData.analyses.map((analysis) => (
                <div
                  key={analysis.id}
                  style={{
                    backgroundColor: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: "0.5rem",
                    overflow: "hidden",
                  }}
                >
                  {/* Analysis header */}
                  <div style={{
                    padding: "0.75rem 1.25rem",
                    borderBottom: "1px solid #e5e7eb",
                    backgroundColor: "#f9fafb",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}>
                    <div>
                      <span style={{ fontWeight: "600", fontSize: "0.9rem" }}>{analysis.title}</span>
                      <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.2rem" }}>
                        {new Date(analysis.createdAt).toLocaleString()}
                        {analysis.model && <> &middot; {analysis.model}</>}
                      </div>
                    </div>
                    <span style={{
                      fontSize: "0.65rem",
                      padding: "0.15rem 0.5rem",
                      backgroundColor: "#ecfdf5",
                      color: "#059669",
                      borderRadius: "9999px",
                      fontWeight: "500",
                    }}>
                      {analysis.analysisType}
                    </span>
                  </div>

                  {/* Analysis content — rendered as markdown-like sections */}
                  <div style={{ padding: "1.25rem" }}>
                    <MeetingSummaryContent content={analysis.content} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MeetingSummaryContent({ content }: { content: string }) {
  // Split content into sections by markdown headers
  const sections = content.split(/^(#{1,3}\s+.+)$/gm);

  return (
    <div style={{ fontSize: "0.85rem", lineHeight: "1.7", color: "#374151" }}>
      {sections.map((section, i) => {
        const trimmed = section.trim();
        if (!trimmed) return null;

        // Render headers
        if (trimmed.startsWith("### ")) {
          return (
            <h4
              key={i}
              style={{
                fontSize: "0.95rem",
                fontWeight: "600",
                color: "#1f2937",
                marginTop: i === 0 ? "0" : "1.5rem",
                marginBottom: "0.5rem",
                borderBottom: "1px solid #f3f4f6",
                paddingBottom: "0.3rem",
              }}
            >
              {trimmed.replace(/^###\s+/, "")}
            </h4>
          );
        }
        if (trimmed.startsWith("## ")) {
          return (
            <h3
              key={i}
              style={{
                fontSize: "1.05rem",
                fontWeight: "600",
                color: "#111827",
                marginTop: i === 0 ? "0" : "1.75rem",
                marginBottom: "0.5rem",
                borderBottom: "1px solid #e5e7eb",
                paddingBottom: "0.4rem",
              }}
            >
              {trimmed.replace(/^##\s+/, "")}
            </h3>
          );
        }

        // Render body text — handle bullet points and bold
        return (
          <div key={i} style={{ marginBottom: "0.5rem" }}>
            {trimmed.split("\n").map((line, j) => {
              const l = line.trim();
              if (!l) return <br key={j} />;

              // Render as list item if starts with - or number.
              const isBullet = /^[-*]\s/.test(l);
              const isNumbered = /^\d+\.\s/.test(l);

              const rendered = renderInlineFormatting(l.replace(/^[-*]\s+|^\d+\.\s+/, ""));

              if (isBullet || isNumbered) {
                return (
                  <div
                    key={j}
                    style={{
                      paddingLeft: "1.25rem",
                      position: "relative",
                      marginBottom: "0.3rem",
                    }}
                  >
                    <span style={{ position: "absolute", left: "0.25rem", color: "#9ca3af" }}>
                      {isNumbered ? l.match(/^\d+/)?.[0] + "." : "\u2022"}
                    </span>
                    {rendered}
                  </div>
                );
              }

              return <p key={j} style={{ margin: "0 0 0.3rem" }}>{rendered}</p>;
            })}
          </div>
        );
      })}
    </div>
  );
}

function renderInlineFormatting(text: string): React.ReactNode {
  // Simple bold (**text**) rendering
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} style={{ fontWeight: "600", color: "#1f2937" }}>
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
