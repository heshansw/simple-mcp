import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  integrationError,
  authorizationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import { domainErrorMessage } from "../../shared/result.js";
import type { GoogleTokenBundle } from "../../shared/schemas/google-common.schema.js";

// ── Google Meet API response types ──────────────────────────────────────

export type ConferenceRecord = {
  name: string; // "conferenceRecords/abc123"
  startTime: string;
  endTime: string;
  space: string; // "spaces/xyz"
  expireTime: string;
};

export type Participant = {
  name: string; // "conferenceRecords/abc/participants/xyz"
  earliestStartTime: string;
  latestEndTime: string;
  signedinUser?: {
    user: string;
    displayName: string;
  };
  anonymousUser?: {
    displayName: string;
  };
  phoneUser?: {
    displayName: string;
  };
};

export type TranscriptMetadata = {
  name: string; // "conferenceRecords/abc/transcripts/def"
  docsDestination?: { document: string; exportUri: string };
  state: "STARTED" | "ENDED";
  startTime: string;
  endTime: string;
};

export type TranscriptEntry = {
  name: string; // "conferenceRecords/abc/transcripts/def/entries/ghi"
  participant: string; // "conferenceRecords/abc/participants/xyz"
  text: string;
  languageCode: string;
  startOffset: string; // duration format, e.g. "120.5s"
  endOffset: string;
};

export type PrerequisitesStatus = {
  hasValidToken: boolean;
  hasMeetScope: boolean;
  canListMeetings: boolean;
  diagnosticMessages: string[];
};

type ConferenceRecordListResponse = {
  conferenceRecords?: ConferenceRecord[];
  nextPageToken?: string;
};

type ParticipantListResponse = {
  participants?: Participant[];
  nextPageToken?: string;
};

type TranscriptListResponse = {
  transcripts?: TranscriptMetadata[];
  nextPageToken?: string;
};

type TranscriptEntryListResponse = {
  transcriptEntries?: TranscriptEntry[];
  nextPageToken?: string;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
};

// ── Constants ───────────────────────────────────────────────────────────

const GOOGLE_MEET_API = "https://meet.googleapis.com/v2";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// ── Dependencies ────────────────────────────────────────────────────────

export type GoogleMeetDependencies = {
  logger: Logger;
  clientId: string;
  clientSecret: string;
  getConnectionInfo: () => Promise<{
    connectionId: string;
    tokens: GoogleTokenBundle;
  } | null>;
  storeUpdatedTokens: (connectionId: string, tokens: GoogleTokenBundle) => Promise<void>;
};

// ── Service interface ───────────────────────────────────────────────────

export interface GoogleMeetServiceResult {
  listConferenceRecords(params: {
    filter?: string;
    pageSize?: number;
    pageToken?: string;
  }): Promise<Result<{ records: ConferenceRecord[]; nextPageToken?: string }, DomainError>>;

  getConferenceRecord(name: string): Promise<Result<ConferenceRecord, DomainError>>;

  listParticipants(conferenceRecordName: string): Promise<Result<Participant[], DomainError>>;

  listTranscripts(conferenceRecordName: string): Promise<Result<TranscriptMetadata[], DomainError>>;

  getTranscriptEntries(transcriptName: string): Promise<Result<TranscriptEntry[], DomainError>>;

  checkPrerequisites(): Promise<Result<PrerequisitesStatus, DomainError>>;

  refreshTokenIfNeeded(
    connectionId: string,
    tokens: GoogleTokenBundle
  ): Promise<Result<GoogleTokenBundle, DomainError>>;
}

// ── Implementation ──────────────────────────────────────────────────────

export function createGoogleMeetService(
  deps: GoogleMeetDependencies
): GoogleMeetServiceResult {
  const { logger } = deps;

  async function resolveTokens(): Promise<
    Result<{ connectionId: string; tokens: GoogleTokenBundle }, DomainError>
  > {
    const info = await deps.getConnectionInfo();
    if (!info) {
      return err(
        authorizationError(
          "No Google connection found. Connect via the admin panel OAuth flow.",
          "google-meet"
        )
      );
    }

    // Proactively refresh if near expiry
    const expiry = new Date(info.tokens.expiry).getTime();
    const now = Date.now();
    if (expiry - now < TOKEN_REFRESH_THRESHOLD_MS) {
      logger.debug("Google token near expiry, refreshing proactively");
      const refreshResult = await refreshTokenImpl(info.connectionId, info.tokens);
      if (refreshResult._tag === "Err") return refreshResult;
      return ok({ connectionId: info.connectionId, tokens: refreshResult.value });
    }

    return ok(info);
  }

  async function meetFetch<T>(
    tokens: GoogleTokenBundle,
    url: string,
    options: RequestInit = {}
  ): Promise<Result<T, DomainError>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    };

    const response = await fetch(url, { ...options, headers });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(
        { status: response.status, url: url.split("?")[0], body: body.slice(0, 300) },
        "Google Meet API request failed"
      );

      if (response.status === 401) {
        return err(
          authorizationError(
            "Google OAuth token is invalid or expired. Re-authenticate via the admin panel.",
            "google-meet"
          )
        );
      }

      if (response.status === 403) {
        return err(
          integrationError(
            "google-meet",
            "Permission denied. Check that the required Google Meet scopes are granted.",
            403
          )
        );
      }

      if (response.status === 429) {
        return err(
          integrationError("google-meet", "Google Meet API rate limit exceeded. Try again later.", 429)
        );
      }

      if (response.status >= 500) {
        return err(
          integrationError("google-meet", "Google Meet API upstream error", 502)
        );
      }

      return err(integrationError("google-meet", `HTTP ${response.status}`, response.status));
    }

    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return ok(undefined as T);
    }

    const data = (await response.json()) as T;
    return ok(data);
  }

  async function refreshTokenImpl(
    connectionId: string,
    tokens: GoogleTokenBundle
  ): Promise<Result<GoogleTokenBundle, DomainError>> {
    try {
      const body = new URLSearchParams({
        client_id: deps.clientId,
        client_secret: deps.clientSecret,
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      });

      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        logger.error(
          { status: response.status, body: errorBody.slice(0, 300) },
          "Google token refresh failed"
        );
        return err(
          authorizationError(
            "Failed to refresh Google OAuth token. Re-authenticate via the admin panel.",
            "google-meet"
          )
        );
      }

      const tokenData = (await response.json()) as GoogleTokenResponse;
      const newTokens: GoogleTokenBundle = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? tokens.refresh_token,
        expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      };

      await deps.storeUpdatedTokens(connectionId, newTokens);
      logger.info("Google OAuth token refreshed successfully (Meet)");

      return ok(newTokens);
    } catch (error) {
      logger.error({ error }, "Unexpected error during Google token refresh");
      return err(
        integrationError("google-meet", "Failed to refresh token: unexpected error")
      );
    }
  }

  /** Paginate through all pages of a list endpoint */
  async function fetchAllPages<TItem>(
    tokens: GoogleTokenBundle,
    baseUrl: string,
    extractItems: (data: Record<string, unknown>) => TItem[] | undefined,
    maxPages: number = 20
  ): Promise<Result<TItem[], DomainError>> {
    const allItems: TItem[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    while (pageCount < maxPages) {
      const url = pageToken
        ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}pageToken=${pageToken}`
        : baseUrl;

      const result = await meetFetch<Record<string, unknown>>(tokens, url);
      if (result._tag === "Err") return result;

      const items = extractItems(result.value);
      if (items) allItems.push(...items);

      pageToken = result.value.nextPageToken as string | undefined;
      if (!pageToken) break;
      pageCount++;
    }

    return ok(allItems);
  }

  return {
    async listConferenceRecords(params): Promise<
      Result<{ records: ConferenceRecord[]; nextPageToken?: string }, DomainError>
    > {
      try {
        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;

        const queryParams = new URLSearchParams();
        if (params.filter) queryParams.set("filter", params.filter);
        if (params.pageSize) queryParams.set("pageSize", String(params.pageSize));
        if (params.pageToken) queryParams.set("pageToken", params.pageToken);

        const url = `${GOOGLE_MEET_API}/conferenceRecords?${queryParams.toString()}`;
        const result = await meetFetch<ConferenceRecordListResponse>(
          tokenResult.value.tokens,
          url
        );
        if (result._tag === "Err") return result;

        const response: { records: ConferenceRecord[]; nextPageToken?: string } = {
          records: result.value.conferenceRecords ?? [],
        };
        if (result.value.nextPageToken) {
          response.nextPageToken = result.value.nextPageToken;
        }
        return ok(response);
      } catch (error) {
        logger.error({ error }, "Failed to list conference records");
        return err(integrationError("google-meet", "Failed to list conference records: unexpected error"));
      }
    },

    async getConferenceRecord(name): Promise<Result<ConferenceRecord, DomainError>> {
      try {
        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;

        const url = `${GOOGLE_MEET_API}/${name}`;
        return await meetFetch<ConferenceRecord>(tokenResult.value.tokens, url);
      } catch (error) {
        logger.error({ error, name }, "Failed to get conference record");
        return err(integrationError("google-meet", "Failed to get conference record: unexpected error"));
      }
    },

    async listParticipants(conferenceRecordName): Promise<Result<Participant[], DomainError>> {
      try {
        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;

        const baseUrl = `${GOOGLE_MEET_API}/${conferenceRecordName}/participants?pageSize=100`;
        return await fetchAllPages<Participant>(
          tokenResult.value.tokens,
          baseUrl,
          (data) => (data as unknown as ParticipantListResponse).participants
        );
      } catch (error) {
        logger.error({ error, conferenceRecordName }, "Failed to list participants");
        return err(integrationError("google-meet", "Failed to list participants: unexpected error"));
      }
    },

    async listTranscripts(conferenceRecordName): Promise<Result<TranscriptMetadata[], DomainError>> {
      try {
        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;

        const baseUrl = `${GOOGLE_MEET_API}/${conferenceRecordName}/transcripts?pageSize=100`;
        return await fetchAllPages<TranscriptMetadata>(
          tokenResult.value.tokens,
          baseUrl,
          (data) => (data as unknown as TranscriptListResponse).transcripts
        );
      } catch (error) {
        logger.error({ error, conferenceRecordName }, "Failed to list transcripts");
        return err(integrationError("google-meet", "Failed to list transcripts: unexpected error"));
      }
    },

    async getTranscriptEntries(transcriptName): Promise<Result<TranscriptEntry[], DomainError>> {
      try {
        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;

        const baseUrl = `${GOOGLE_MEET_API}/${transcriptName}/entries?pageSize=100`;
        return await fetchAllPages<TranscriptEntry>(
          tokenResult.value.tokens,
          baseUrl,
          (data) => (data as unknown as TranscriptEntryListResponse).transcriptEntries
        );
      } catch (error) {
        logger.error({ error, transcriptName }, "Failed to get transcript entries");
        return err(integrationError("google-meet", "Failed to get transcript entries: unexpected error"));
      }
    },

    async checkPrerequisites(): Promise<Result<PrerequisitesStatus, DomainError>> {
      const diagnosticMessages: string[] = [];
      let hasValidToken = false;
      let hasMeetScope = false;
      let canListMeetings = false;

      // Check token availability
      const info = await deps.getConnectionInfo();
      if (!info) {
        diagnosticMessages.push("No Google connection found. Complete the OAuth flow in the admin panel.");
        return ok({ hasValidToken, hasMeetScope, canListMeetings, diagnosticMessages });
      }

      hasValidToken = true;
      diagnosticMessages.push("Google OAuth token found.");

      // Try to list conference records to verify Meet scope
      try {
        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") {
          diagnosticMessages.push(`Token validation failed: ${domainErrorMessage(tokenResult.error)}`);
          hasValidToken = false;
          return ok({ hasValidToken, hasMeetScope, canListMeetings, diagnosticMessages });
        }

        const testUrl = `${GOOGLE_MEET_API}/conferenceRecords?pageSize=1`;
        const testResult = await meetFetch<ConferenceRecordListResponse>(
          tokenResult.value.tokens,
          testUrl
        );

        if (testResult._tag === "Err") {
          if (testResult.error._tag === "AuthorizationError") {
            diagnosticMessages.push("Meet API access denied — the OAuth token may lack the meetings.space.readonly scope. Re-authenticate to grant Meet access.");
          } else {
            diagnosticMessages.push(`Meet API probe failed: ${domainErrorMessage(testResult.error)}`);
          }
          return ok({ hasValidToken, hasMeetScope, canListMeetings, diagnosticMessages });
        }

        hasMeetScope = true;
        canListMeetings = true;
        diagnosticMessages.push("Google Meet API access confirmed. Transcript retrieval is available.");
      } catch (error) {
        diagnosticMessages.push(`Unexpected error during prerequisites check: ${error instanceof Error ? error.message : String(error)}`);
      }

      return ok({ hasValidToken, hasMeetScope, canListMeetings, diagnosticMessages });
    },

    async refreshTokenIfNeeded(connectionId, tokens): Promise<Result<GoogleTokenBundle, DomainError>> {
      const expiry = new Date(tokens.expiry).getTime();
      const now = Date.now();
      if (expiry - now < TOKEN_REFRESH_THRESHOLD_MS) {
        return refreshTokenImpl(connectionId, tokens);
      }
      return ok(tokens);
    },
  };
}
