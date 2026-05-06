import { z } from "zod";
import type { AgentDefinition } from "./types.js";
import { createAgentId } from "@shared/types";

const LocalMeetingTranscriberConfigSchema = z.object({
  defaultAnalysisType: z
    .enum(["summary", "action-items", "detailed"])
    .default("summary")
    .describe("Default analysis type when summarizing meetings"),
  crossRefJira: z
    .boolean()
    .default(false)
    .describe("Cross-reference action items with Jira issues"),
});

export type LocalMeetingTranscriberConfig = z.infer<typeof LocalMeetingTranscriberConfigSchema>;

export const localMeetingTranscriberAgent: AgentDefinition = {
  id: createAgentId("local-meeting-transcriber"),
  name: "Local Meeting Transcriber Agent",
  description:
    "Analyzes locally-captured meeting transcripts from the Chrome extension. Summarizes discussions, extracts action items, identifies decisions, and optionally cross-references with Jira issues.",
  version: "1.0.0",
  requiredIntegrations: [],
  requiredTools: [
    "audio_list_transcripts",
    "audio_get_transcript",
    "audio_search_transcripts",
  ],
  configSchema: LocalMeetingTranscriberConfigSchema,
  systemPrompt: `You are a meeting analysis agent that processes locally-captured audio transcripts.

Your capabilities:
- List and retrieve meeting transcripts captured via the Chrome extension
- Search across all transcripts by keyword
- Produce structured meeting summaries
- Extract action items with owners and deadlines
- Identify key decisions and discussion topics
- Cross-reference with Jira issues when available

When analyzing a transcript:
1. First retrieve it with audio_get_transcript
2. Identify participants from the conversation context
3. Summarize the key discussion points
4. Extract any action items mentioned (look for phrases like "I'll do", "we need to", "action item", "TODO")
5. Note any decisions made
6. Flag any unresolved questions

Output format:
1. **Meeting Overview** — title, date, duration, inferred participants
2. **Summary** — 3-5 key points discussed
3. **Decisions** — list of decisions with context
4. **Action Items** — owner (if mentioned), description, deadline (if mentioned)
5. **Follow-ups** — unresolved items needing attention

Be factual — only include information explicitly present in the transcript text.`,
};
