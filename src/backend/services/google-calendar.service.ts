import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  integrationError,
  validationError,
  authorizationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";

// ── Google Calendar API response/request types ──────────────────────────

export type CalendarEvent = {
  event_id: string;
  title: string;
  start: string;
  end: string;
  attendees: Array<{
    email: string;
    response_status: "accepted" | "declined" | "tentative" | "needsAction";
  }>;
  location: string | null;
  description: string | null;
  meeting_link: string | null;
};

export type FreeBusyResult = {
  email: string;
  busy_slots: Array<{ start: string; end: string }>;
};

export type Room = {
  resource_email: string;
  display_name: string;
  capacity: number | null;
  available: boolean;
};

export type GoogleTokenBundle = {
  access_token: string;
  refresh_token: string;
  expiry: string; // ISO 8601
};

// ── Constants ───────────────────────────────────────────────────────────

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_ADMIN_API = "https://admin.googleapis.com/admin/directory/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TIME_RANGE_DAYS = 60;
const MIN_EVENT_DURATION_MS = 60 * 1000; // 1 minute

// ── Dependencies ────────────────────────────────────────────────────────

export type GoogleCalendarDependencies = {
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

export interface GoogleCalendarServiceResult {
  listEvents(
    calendarId: string,
    timeMin: string,
    timeMax: string,
    maxResults: number
  ): Promise<Result<CalendarEvent[], DomainError>>;

  createEvent(params: {
    title: string;
    start: string;
    end: string;
    description?: string;
    attendees?: string[];
    roomResourceEmail?: string;
    addMeetLink?: boolean;
    timezone?: string;
  }): Promise<Result<CalendarEvent, DomainError>>;

  checkAvailability(
    emails: string[],
    timeMin: string,
    timeMax: string
  ): Promise<Result<FreeBusyResult[], DomainError>>;

  listAvailableRooms(
    timeMin: string,
    timeMax: string,
    minCapacity?: number
  ): Promise<Result<Room[], DomainError>>;

  refreshTokenIfNeeded(
    connectionId: string,
    tokens: GoogleTokenBundle
  ): Promise<Result<GoogleTokenBundle, DomainError>>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function validateTimeRange(timeMin: string, timeMax: string): Result<void, DomainError> {
  const min = new Date(timeMin);
  const max = new Date(timeMax);

  if (isNaN(min.getTime()) || isNaN(max.getTime())) {
    return err(validationError("Invalid ISO 8601 datetime format"));
  }

  if (max <= min) {
    return err(validationError("time_max must be after time_min"));
  }

  const rangeDays = (max.getTime() - min.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays > MAX_TIME_RANGE_DAYS) {
    return err(
      validationError(
        `Time range must be ≤ ${MAX_TIME_RANGE_DAYS} days, got ${Math.ceil(rangeDays)} days`
      )
    );
  }

  return ok(undefined);
}

function mapGoogleEvent(event: GoogleCalendarApiEvent): CalendarEvent {
  const meetLink = event.conferenceData?.entryPoints?.find(
    (ep) => ep.entryPointType === "video"
  )?.uri ?? null;

  return {
    event_id: event.id,
    title: event.summary ?? "(No title)",
    start: event.start?.dateTime ?? event.start?.date ?? "",
    end: event.end?.dateTime ?? event.end?.date ?? "",
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      response_status: (a.responseStatus ?? "needsAction") as CalendarEvent["attendees"][number]["response_status"],
    })),
    location: event.location ?? null,
    description: event.description ?? null,
    meeting_link: meetLink,
  };
}

// ── Google API raw types ────────────────────────────────────────────────

type GoogleCalendarApiEvent = {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: Array<{
    email: string;
    responseStatus?: string;
    resource?: boolean;
  }>;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType: string;
      uri: string;
    }>;
  };
};

type GoogleEventsListResponse = {
  items: GoogleCalendarApiEvent[];
  nextPageToken?: string;
};

type GoogleFreeBusyResponse = {
  calendars: Record<
    string,
    { busy: Array<{ start: string; end: string }>; errors?: Array<{ reason: string }> }
  >;
};

type GoogleDirectoryResourcesResponse = {
  items?: Array<{
    resourceEmail: string;
    generatedResourceName: string;
    resourceName: string;
    capacity?: number;
  }>;
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
};

// ── Implementation ──────────────────────────────────────────────────────

export function createGoogleCalendarService(
  deps: GoogleCalendarDependencies
): GoogleCalendarServiceResult {
  const { logger } = deps;

  async function resolveTokens(): Promise<
    Result<{ connectionId: string; tokens: GoogleTokenBundle }, DomainError>
  > {
    const info = await deps.getConnectionInfo();
    if (!info) {
      return err(
        authorizationError(
          "No Google Calendar connection found. Connect via the admin panel OAuth flow.",
          "google-calendar"
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

  async function googleFetch<T>(
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
        "Google API request failed"
      );

      if (response.status === 401) {
        return err(
          authorizationError(
            "Google OAuth token is invalid or expired. Re-authenticate via the admin panel.",
            "google-calendar"
          )
        );
      }

      if (response.status === 403) {
        return err(
          integrationError(
            "google-calendar",
            "Permission denied. Check that the required Google Calendar scopes are granted.",
            403
          )
        );
      }

      if (response.status === 429) {
        return err(
          integrationError("google-calendar", "Google API rate limit exceeded. Try again later.", 429)
        );
      }

      if (response.status >= 500) {
        return err(
          integrationError("google-calendar", "Google API upstream error", 502)
        );
      }

      return err(integrationError("google-calendar", `HTTP ${response.status}`, response.status));
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
            "google-calendar"
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
      logger.info("Google OAuth token refreshed successfully");

      return ok(newTokens);
    } catch (error) {
      logger.error({ error }, "Unexpected error during Google token refresh");
      return err(
        integrationError("google-calendar", "Failed to refresh token: unexpected error")
      );
    }
  }

  return {
    async listEvents(
      calendarId: string,
      timeMin: string,
      timeMax: string,
      maxResults: number
    ): Promise<Result<CalendarEvent[], DomainError>> {
      try {
        const rangeCheck = validateTimeRange(timeMin, timeMax);
        if (rangeCheck._tag === "Err") return rangeCheck;

        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;
        const { tokens } = tokenResult.value;

        logger.debug({ calendarId, timeMin, timeMax, maxResults }, "Listing Google Calendar events");

        const params = new URLSearchParams({
          timeMin: new Date(timeMin).toISOString(),
          timeMax: new Date(timeMax).toISOString(),
          maxResults: String(maxResults),
          singleEvents: "true",
          orderBy: "startTime",
        });

        const result = await googleFetch<GoogleEventsListResponse>(
          tokens,
          `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
        );

        if (result._tag === "Err") return result;

        return ok((result.value.items ?? []).map(mapGoogleEvent));
      } catch (error) {
        logger.error({ error }, "Failed to list Google Calendar events");
        return err(integrationError("google-calendar", "Failed to list events: unexpected error"));
      }
    },

    async createEvent(params): Promise<Result<CalendarEvent, DomainError>> {
      try {
        // Validate end > start and min duration
        const startMs = new Date(params.start).getTime();
        const endMs = new Date(params.end).getTime();

        if (isNaN(startMs) || isNaN(endMs)) {
          return err(validationError("Invalid ISO 8601 datetime format for start/end"));
        }

        if (endMs <= startMs) {
          return err(validationError("Event end must be after start"));
        }

        if (endMs - startMs < MIN_EVENT_DURATION_MS) {
          return err(validationError("Minimum event duration is 1 minute"));
        }

        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;
        const { tokens } = tokenResult.value;

        // Business rule: validate room availability before creating
        if (params.roomResourceEmail) {
          const freeBusyResult = await this.checkAvailability(
            [params.roomResourceEmail],
            params.start,
            params.end
          );
          if (freeBusyResult._tag === "Err") return freeBusyResult;

          const roomBusy = freeBusyResult.value.find(
            (fb) => fb.email === params.roomResourceEmail
          );
          if (roomBusy && roomBusy.busy_slots.length > 0) {
            return err(
              integrationError(
                "google-calendar",
                `Room ${params.roomResourceEmail} is busy in the requested slot`,
                409
              )
            );
          }
        }

        logger.debug({ title: params.title }, "Creating Google Calendar event");

        const eventBody: Record<string, unknown> = {
          summary: params.title,
          start: { dateTime: params.start, timeZone: params.timezone },
          end: { dateTime: params.end, timeZone: params.timezone },
        };

        if (params.description) {
          eventBody.description = params.description;
        }

        const attendees: Array<{ email: string; resource?: boolean }> = [];
        if (params.attendees) {
          for (const email of params.attendees) {
            attendees.push({ email });
          }
        }
        if (params.roomResourceEmail) {
          attendees.push({ email: params.roomResourceEmail, resource: true });
        }
        if (attendees.length > 0) {
          eventBody.attendees = attendees;
        }

        // Google Meet link
        if (params.addMeetLink) {
          eventBody.conferenceData = {
            createRequest: {
              requestId: `meet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          };
        }

        const queryParams = new URLSearchParams();
        if (params.addMeetLink) {
          queryParams.set("conferenceDataVersion", "1");
        }

        const url = `${GOOGLE_CALENDAR_API}/calendars/primary/events${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;

        const result = await googleFetch<GoogleCalendarApiEvent>(tokens, url, {
          method: "POST",
          body: JSON.stringify(eventBody),
        });

        if (result._tag === "Err") return result;

        return ok(mapGoogleEvent(result.value));
      } catch (error) {
        logger.error({ error }, "Failed to create Google Calendar event");
        return err(integrationError("google-calendar", "Failed to create event: unexpected error"));
      }
    },

    async checkAvailability(
      emails: string[],
      timeMin: string,
      timeMax: string
    ): Promise<Result<FreeBusyResult[], DomainError>> {
      try {
        const rangeCheck = validateTimeRange(timeMin, timeMax);
        if (rangeCheck._tag === "Err") return rangeCheck;

        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;
        const { tokens } = tokenResult.value;

        logger.debug({ emailCount: emails.length, timeMin, timeMax }, "Checking availability");

        // Single batched FreeBusy API call (business rule #2)
        const freeBusyBody = {
          timeMin: new Date(timeMin).toISOString(),
          timeMax: new Date(timeMax).toISOString(),
          items: emails.map((email) => ({ id: email })),
        };

        const result = await googleFetch<GoogleFreeBusyResponse>(
          tokens,
          `${GOOGLE_CALENDAR_API}/freeBusy`,
          {
            method: "POST",
            body: JSON.stringify(freeBusyBody),
          }
        );

        if (result._tag === "Err") return result;

        const freeBusyResults: FreeBusyResult[] = emails.map((email) => {
          const calendar = result.value.calendars[email];
          return {
            email,
            busy_slots: calendar?.busy ?? [],
          };
        });

        return ok(freeBusyResults);
      } catch (error) {
        logger.error({ error }, "Failed to check Google Calendar availability");
        return err(integrationError("google-calendar", "Failed to check availability: unexpected error"));
      }
    },

    async listAvailableRooms(
      timeMin: string,
      timeMax: string,
      minCapacity?: number
    ): Promise<Result<Room[], DomainError>> {
      try {
        const rangeCheck = validateTimeRange(timeMin, timeMax);
        if (rangeCheck._tag === "Err") return rangeCheck;

        const tokenResult = await resolveTokens();
        if (tokenResult._tag === "Err") return tokenResult;
        const { tokens } = tokenResult.value;

        logger.debug({ timeMin, timeMax, minCapacity }, "Listing available rooms");

        // Step 1: Fetch room resources from Admin Directory API
        const roomsResult = await googleFetch<GoogleDirectoryResourcesResponse>(
          tokens,
          `${GOOGLE_ADMIN_API}/customer/my_customer/resources/calendars`
        );

        if (roomsResult._tag === "Err") {
          // Gracefully handle missing scope — return empty list with reason
          if (roomsResult.error._tag === "IntegrationError" && roomsResult.error.statusCode === 403) {
            logger.warn("Admin Directory scope not available, returning empty room list");
            return ok([]);
          }
          return roomsResult;
        }

        const allRooms = roomsResult.value.items ?? [];

        // Filter by capacity if specified
        const filteredRooms = minCapacity
          ? allRooms.filter((r) => (r.capacity ?? 0) >= minCapacity)
          : allRooms;

        if (filteredRooms.length === 0) {
          return ok([]);
        }

        // Step 2: Check room availability via FreeBusy
        const roomEmails = filteredRooms.map((r) => r.resourceEmail);
        const freeBusyResult = await this.checkAvailability(roomEmails, timeMin, timeMax);

        if (freeBusyResult._tag === "Err") return freeBusyResult;

        const busyMap = new Map<string, boolean>();
        for (const fb of freeBusyResult.value) {
          busyMap.set(fb.email, fb.busy_slots.length > 0);
        }

        // Return only available rooms
        const rooms: Room[] = filteredRooms
          .map((r) => ({
            resource_email: r.resourceEmail,
            display_name: r.resourceName || r.generatedResourceName,
            capacity: r.capacity ?? null,
            available: !busyMap.get(r.resourceEmail),
          }))
          .filter((r) => r.available);

        return ok(rooms);
      } catch (error) {
        logger.error({ error }, "Failed to list available rooms");
        return err(integrationError("google-calendar", "Failed to list rooms: unexpected error"));
      }
    },

    async refreshTokenIfNeeded(
      connectionId: string,
      tokens: GoogleTokenBundle
    ): Promise<Result<GoogleTokenBundle, DomainError>> {
      const expiry = new Date(tokens.expiry).getTime();
      const now = Date.now();

      if (expiry - now < TOKEN_REFRESH_THRESHOLD_MS) {
        return await refreshTokenImpl(connectionId, tokens);
      }

      return ok(tokens);
    },
  };
}
