import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Logger } from "pino";
import { registerCheckPrerequisitesTool } from "./check-prerequisites.tool.js";
import { registerListMeetingsTool } from "./list-meetings.tool.js";
import { registerGetTranscriptTool } from "./get-transcript.tool.js";
import { registerSearchTranscriptsTool } from "./search-transcripts.tool.js";
import type { GoogleMeetServiceResult } from "../../services/google-meet.service.js";
import type { MeetTranscriptsRepository } from "../../db/repositories/meet-transcripts.repository.js";

// ── Fixtures ─────────────────────────────────────────────────────────

function createLoggerStub(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createMockMeetService(overrides?: Partial<GoogleMeetServiceResult>): GoogleMeetServiceResult {
  return {
    listConferenceRecords: vi.fn().mockResolvedValue({
      _tag: "Ok" as const,
      value: {
        records: [
          {
            name: "conferenceRecords/abc123",
            startTime: "2026-05-05T10:00:00Z",
            endTime: "2026-05-05T11:00:00Z",
            space: "spaces/xyz",
            expireTime: "2026-06-05T11:00:00Z",
          },
        ],
        nextPageToken: undefined,
      },
    }),
    getConferenceRecord: vi.fn(),
    listParticipants: vi.fn().mockResolvedValue({
      _tag: "Ok" as const,
      value: [
        {
          name: "conferenceRecords/abc123/participants/p1",
          earliestStartTime: "2026-05-05T10:00:00Z",
          latestEndTime: "2026-05-05T11:00:00Z",
          signedinUser: { user: "users/1", displayName: "Alice" },
        },
      ],
    }),
    listTranscripts: vi.fn().mockResolvedValue({
      _tag: "Ok" as const,
      value: [
        {
          name: "conferenceRecords/abc123/transcripts/t1",
          state: "ENDED",
          startTime: "2026-05-05T10:00:00Z",
          endTime: "2026-05-05T11:00:00Z",
        },
      ],
    }),
    getTranscriptEntries: vi.fn().mockResolvedValue({
      _tag: "Ok" as const,
      value: [
        {
          name: "conferenceRecords/abc123/transcripts/t1/entries/e1",
          participant: "conferenceRecords/abc123/participants/p1",
          text: "Hello everyone, let's get started",
          languageCode: "en-US",
          startOffset: "5s",
          endOffset: "8s",
        },
        {
          name: "conferenceRecords/abc123/transcripts/t1/entries/e2",
          participant: "conferenceRecords/abc123/participants/p1",
          text: "First topic is the sprint review",
          languageCode: "en-US",
          startOffset: "10s",
          endOffset: "14s",
        },
      ],
    }),
    checkPrerequisites: vi.fn().mockResolvedValue({
      _tag: "Ok" as const,
      value: {
        hasValidToken: true,
        hasMeetScope: true,
        canListMeetings: true,
        diagnosticMessages: ["Google Meet API access confirmed."],
      },
    }),
    refreshTokenIfNeeded: vi.fn(),
    ...overrides,
  };
}

async function setupToolServer(
  registerFn: (server: McpServer, deps: any) => void,
  deps: Record<string, unknown>
): Promise<Client> {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerFn(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return client;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("google_meet_check_prerequisites", () => {
  it("returns formatted prerequisites status", async () => {
    const service = createMockMeetService();
    const client = await setupToolServer(registerCheckPrerequisitesTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({ name: "google_meet_check_prerequisites", arguments: {} });

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("OAuth Token: ✓ Valid");
    expect(text).toContain("Meet API Scope: ✓ Granted");
    expect(text).toContain("Can List Meetings: ✓ Yes");
  });

  it("reports missing token", async () => {
    const service = createMockMeetService({
      checkPrerequisites: vi.fn().mockResolvedValue({
        _tag: "Ok" as const,
        value: {
          hasValidToken: false,
          hasMeetScope: false,
          canListMeetings: false,
          diagnosticMessages: ["No Google connection found."],
        },
      }),
    });
    const client = await setupToolServer(registerCheckPrerequisitesTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({ name: "google_meet_check_prerequisites", arguments: {} });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("OAuth Token: ✗ Missing or invalid");
  });
});

describe("google_meet_list_meetings", () => {
  it("lists meetings with default since_hours", async () => {
    const service = createMockMeetService();
    const client = await setupToolServer(registerListMeetingsTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_list_meetings",
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Recent Meetings");
    expect(text).toContain("conferenceRecords/abc123");
    expect(service.listConferenceRecords).toHaveBeenCalledTimes(1);
  });

  it("shows empty message when no meetings", async () => {
    const service = createMockMeetService({
      listConferenceRecords: vi.fn().mockResolvedValue({
        _tag: "Ok" as const,
        value: { records: [], nextPageToken: undefined },
      }),
    });
    const client = await setupToolServer(registerListMeetingsTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_list_meetings",
      arguments: { since_hours: 48 },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("No meetings found");
  });

  it("returns error on service failure", async () => {
    const service = createMockMeetService({
      listConferenceRecords: vi.fn().mockResolvedValue({
        _tag: "Err" as const,
        error: { _tag: "AuthorizationError", message: "Token expired" },
      }),
    });
    const client = await setupToolServer(registerListMeetingsTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_list_meetings",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Error");
  });
});

describe("google_meet_get_transcript", () => {
  it("returns dialogue-formatted transcript with speaker names", async () => {
    const service = createMockMeetService();
    const client = await setupToolServer(registerGetTranscriptTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_get_transcript",
      arguments: {
        conference_record_name: "conferenceRecords/abc123",
      },
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Meeting Transcript");
    expect(text).toContain("**Alice:**");
    expect(text).toContain("Hello everyone");
    expect(text).toContain("[00:00:05]");
    expect(service.listTranscripts).toHaveBeenCalledWith("conferenceRecords/abc123");
    expect(service.listParticipants).toHaveBeenCalledWith("conferenceRecords/abc123");
  });

  it("returns raw JSON when format is raw", async () => {
    const service = createMockMeetService();
    const client = await setupToolServer(registerGetTranscriptTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_get_transcript",
      arguments: {
        conference_record_name: "conferenceRecords/abc123",
        format: "raw",
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.entryCount).toBe(2);
    expect(parsed.entries).toHaveLength(2);
  });

  it("reports no transcripts found", async () => {
    const service = createMockMeetService({
      listTranscripts: vi.fn().mockResolvedValue({
        _tag: "Ok" as const,
        value: [],
      }),
    });
    const client = await setupToolServer(registerGetTranscriptTool, {
      googleMeetService: service,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_get_transcript",
      arguments: {
        conference_record_name: "conferenceRecords/no-transcript",
      },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("No transcripts found");
  });
});

describe("google_meet_search_transcripts", () => {
  it("returns search results", async () => {
    const mockRepo: Partial<MeetTranscriptsRepository> = {
      searchFts: vi.fn().mockResolvedValue([
        {
          transcriptId: "tr-1",
          participantName: "Alice",
          snippet: "discussed the <b>sprint</b> review",
          meetingStartTime: "2026-05-05T10:00:00Z",
        },
      ]),
    };
    const client = await setupToolServer(registerSearchTranscriptsTool, {
      meetTranscriptsRepo: mockRepo,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_search_transcripts",
      arguments: { query: "sprint" },
    });

    expect(result.isError).toBeUndefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("Transcript Search Results");
    expect(text).toContain("Alice");
    expect(text).toContain("sprint");
  });

  it("reports no matches", async () => {
    const mockRepo: Partial<MeetTranscriptsRepository> = {
      searchFts: vi.fn().mockResolvedValue([]),
    };
    const client = await setupToolServer(registerSearchTranscriptsTool, {
      meetTranscriptsRepo: mockRepo,
      logger: createLoggerStub(),
    });

    const result = await client.callTool({
      name: "google_meet_search_transcripts",
      arguments: { query: "nonexistent" },
    });

    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain("No transcript matches found");
  });
});
