import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createGoogleMeetService } from "./google-meet.service.js";
import type { GoogleMeetDependencies } from "./google-meet.service.js";
import type { GoogleTokenBundle } from "../../shared/schemas/google-common.schema.js";

function createLoggerStub(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

const validTokens: GoogleTokenBundle = {
  access_token: "test-access-token",
  refresh_token: "test-refresh-token",
  expiry: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
};

function createDeps(overrides?: Partial<GoogleMeetDependencies>): GoogleMeetDependencies {
  return {
    logger: createLoggerStub(),
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    getConnectionInfo: vi.fn().mockResolvedValue({
      connectionId: "conn-1",
      tokens: validTokens,
    }),
    storeUpdatedTokens: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createGoogleMeetService", () => {
  const originalFetch = global.fetch;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("listConferenceRecords", () => {
    it("returns conference records on success", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            conferenceRecords: [
              {
                name: "conferenceRecords/abc123",
                startTime: "2026-05-05T10:00:00Z",
                endTime: "2026-05-05T11:00:00Z",
                space: "spaces/xyz",
                expireTime: "2026-06-05T11:00:00Z",
              },
            ],
            nextPageToken: "page2",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listConferenceRecords({ pageSize: 10 });

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value.records).toHaveLength(1);
        expect(result.value.records[0].name).toBe("conferenceRecords/abc123");
        expect(result.value.nextPageToken).toBe("page2");
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = fetchMock.mock.calls[0]?.[0] as string;
      expect(url).toContain("meet.googleapis.com/v2/conferenceRecords");
      expect(url).toContain("pageSize=10");
    });

    it("returns empty array when no records", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value.records).toHaveLength(0);
      }
    });

    it("applies filter parameter", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ conferenceRecords: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const service = createGoogleMeetService(createDeps());
      await service.listConferenceRecords({ filter: "end_time>2026-01-01T00:00:00Z" });

      const url = fetchMock.mock.calls[0]?.[0] as string;
      expect(url).toContain("filter=");
    });

    it("returns auth error when no connection", async () => {
      const service = createGoogleMeetService(
        createDeps({ getConnectionInfo: vi.fn().mockResolvedValue(null) })
      );
      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Err");
      if (result._tag === "Err") {
        expect(result.error._tag).toBe("AuthorizationError");
      }
    });
  });

  describe("listParticipants", () => {
    it("returns participants with display names", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            participants: [
              {
                name: "conferenceRecords/abc/participants/p1",
                earliestStartTime: "2026-05-05T10:00:00Z",
                latestEndTime: "2026-05-05T11:00:00Z",
                signedinUser: { user: "users/123", displayName: "Alice" },
              },
              {
                name: "conferenceRecords/abc/participants/p2",
                earliestStartTime: "2026-05-05T10:05:00Z",
                latestEndTime: "2026-05-05T10:55:00Z",
                anonymousUser: { displayName: "Guest" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listParticipants("conferenceRecords/abc");

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].signedinUser?.displayName).toBe("Alice");
        expect(result.value[1].anonymousUser?.displayName).toBe("Guest");
      }
    });
  });

  describe("listTranscripts", () => {
    it("returns transcript metadata", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            transcripts: [
              {
                name: "conferenceRecords/abc/transcripts/t1",
                state: "ENDED",
                startTime: "2026-05-05T10:00:00Z",
                endTime: "2026-05-05T11:00:00Z",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listTranscripts("conferenceRecords/abc");

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].state).toBe("ENDED");
      }
    });
  });

  describe("getTranscriptEntries", () => {
    it("returns all entries with pagination", async () => {
      // Page 1
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            transcriptEntries: [
              {
                name: "conferenceRecords/abc/transcripts/t1/entries/e1",
                participant: "conferenceRecords/abc/participants/p1",
                text: "Hello everyone",
                languageCode: "en-US",
                startOffset: "5s",
                endOffset: "8s",
              },
            ],
            nextPageToken: "page2",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      // Page 2
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            transcriptEntries: [
              {
                name: "conferenceRecords/abc/transcripts/t1/entries/e2",
                participant: "conferenceRecords/abc/participants/p2",
                text: "Hi Alice",
                languageCode: "en-US",
                startOffset: "10s",
                endOffset: "12s",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.getTranscriptEntries("conferenceRecords/abc/transcripts/t1");

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].text).toBe("Hello everyone");
        expect(result.value[1].text).toBe("Hi Alice");
      }
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("error handling", () => {
    it("returns integration error on 403", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 })
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Err");
      if (result._tag === "Err") {
        expect(result.error._tag).toBe("IntegrationError");
        expect(result.error.message).toContain("Permission denied");
      }
    });

    it("returns auth error on 401", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Unauthorized", { status: 401 })
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Err");
      if (result._tag === "Err") {
        expect(result.error._tag).toBe("AuthorizationError");
      }
    });

    it("returns integration error on 429 rate limit", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Too Many Requests", { status: 429 })
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Err");
      if (result._tag === "Err") {
        expect(result.error.message).toContain("rate limit");
      }
    });

    it("returns integration error on 5xx", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Internal Server Error", { status: 500 })
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Err");
      if (result._tag === "Err") {
        expect(result.error.message).toContain("upstream error");
      }
    });
  });

  describe("token refresh", () => {
    it("proactively refreshes token when near expiry", async () => {
      const nearExpiryTokens: GoogleTokenBundle = {
        access_token: "old-token",
        refresh_token: "refresh-token",
        expiry: new Date(Date.now() + 60 * 1000).toISOString(), // 1 minute from now
      };

      const storeUpdatedTokens = vi.fn().mockResolvedValue(undefined);

      // Token refresh call
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            expires_in: 3600,
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      // Actual API call with new token
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ conferenceRecords: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const service = createGoogleMeetService(
        createDeps({
          getConnectionInfo: vi.fn().mockResolvedValue({
            connectionId: "conn-1",
            tokens: nearExpiryTokens,
          }),
          storeUpdatedTokens,
        })
      );

      const result = await service.listConferenceRecords({});

      expect(result._tag).toBe("Ok");
      expect(storeUpdatedTokens).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      // Verify the API call used the new token
      const apiCallHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
      expect(apiCallHeaders?.Authorization).toBe("Bearer new-access-token");
    });

    it("refreshTokenIfNeeded returns existing token when not near expiry", async () => {
      const service = createGoogleMeetService(createDeps());
      const result = await service.refreshTokenIfNeeded("conn-1", validTokens);

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value.access_token).toBe("test-access-token");
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("checkPrerequisites", () => {
    it("reports missing connection", async () => {
      const service = createGoogleMeetService(
        createDeps({ getConnectionInfo: vi.fn().mockResolvedValue(null) })
      );

      const result = await service.checkPrerequisites();

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value.hasValidToken).toBe(false);
        expect(result.value.hasMeetScope).toBe(false);
        expect(result.value.canListMeetings).toBe(false);
        expect(result.value.diagnosticMessages).toContain(
          "No Google connection found. Complete the OAuth flow in the admin panel."
        );
      }
    });

    it("reports success when API responds", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ conferenceRecords: [] }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.checkPrerequisites();

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value.hasValidToken).toBe(true);
        expect(result.value.hasMeetScope).toBe(true);
        expect(result.value.canListMeetings).toBe(true);
      }
    });

    it("reports scope issue on 403", async () => {
      fetchMock.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 })
      );

      const service = createGoogleMeetService(createDeps());
      const result = await service.checkPrerequisites();

      expect(result._tag).toBe("Ok");
      if (result._tag === "Ok") {
        expect(result.value.hasValidToken).toBe(true);
        expect(result.value.hasMeetScope).toBe(false);
        expect(result.value.canListMeetings).toBe(false);
      }
    });
  });
});
