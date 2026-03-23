# 2 — Google Calendar Integration Requirements

> **Status:** Pending Implementation
> **Created:** 2026-03-23

---

## 1. Context & Business Value

**Goal:** Add Google Calendar as an MCP integration — read events, create events with meeting descriptions, check invitee free/busy availability, and query available meeting rooms.

**Scope:** Read-only calendar access + event creation. No update/delete.

---

## 2. Architecture & Dependencies

- **Service file:** `src/backend/services/google-calendar.service.ts`
- **Tools dir:** `src/backend/tools/google-calendar/`
- **Auth:** OAuth 2.0 (authorization_code flow). Tokens stored encrypted in SQLite (`credentials` table). Refresh handled by `src/backend/maintenance/token-refresh.ts`.
- **External API:** Google Calendar API v3 (`https://www.googleapis.com/calendar/v3`)
- **Scopes required:**
  - `https://www.googleapis.com/auth/calendar.readonly`
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly` *(Workspace only — optional, for room listing)*

### OAuth Flow — Critical Constraint

MCP tools run over stdio/SSE and **cannot initiate browser redirects or receive HTTP callbacks**. The full OAuth 2.0 authorization_code flow **must be handled entirely by the admin panel HTTP layer**, not by any MCP tool.

**Required new HTTP endpoints** (add to admin API, not MCP transport):
```
GET /api/connections/google-calendar/oauth/start
    → builds Google consent URL with client_id, scopes, redirect_uri, and a CSRF state nonce
    → stores nonce in DB (short-lived, 10 min TTL)
    → returns redirect URL to frontend

GET /api/connections/google-calendar/oauth/callback?code=XXX&state=YYY
    → validates state nonce (reject if missing/mismatched → 400)
    → exchanges code for { access_token, refresh_token, expiry } via POST https://oauth2.googleapis.com/token
    → encrypts token bundle via encryption.service.ts
    → stores encrypted blob in credentials table linked to the connection row
    → marks connection status = "connected"
    → deletes consumed nonce
    → redirects admin panel to /connections
```

**Client credentials** (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`) loaded from env via `env.schema.ts` — never stored in code or DB.

### Codebase Changes Required Before Implementation

| File | Change |
|---|---|
| `src/backend/services/connection-manager.service.ts` | Add `"google-calendar"` to `integrationType` union (line 33) |
| `src/backend/maintenance/token-refresh.ts` | Implement Google token refresh via `https://oauth2.googleapis.com/token` with `grant_type=refresh_token` |
| `src/backend/config/env.schema.ts` | Add `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` fields |
| Admin API HTTP routes | Add `/oauth/start` and `/oauth/callback` endpoints above |

---

## 3. Data Models

### Connection Config (stored in existing `connections` table)
```
provider:        "google-calendar"
credentials:     { access_token, refresh_token, expiry } — AES-256 encrypted
config:          { calendar_id: string, timezone: string }
```

### CalendarEvent (read shape)
```
event_id:        string
title:           string
start:           ISO 8601 datetime
end:             ISO 8601 datetime
attendees:       { email: string, response_status: "accepted"|"declined"|"tentative"|"needsAction" }[]
location:        string | null
description:     string | null
meeting_link:    string | null   // Google Meet URL from conferenceData
```

### FreeBusy Result
```
email:           string
busy_slots:      { start: ISO 8601, end: ISO 8601 }[]
```

### Room
```
resource_email:  string          // Google Calendar resource email
display_name:    string
capacity:        number | null
available:       boolean
```

---

## 4. MCP Tool Definitions

### `google_calendar_list_events`
List upcoming events from the user's calendar.

**Input:**
```json
{
  "calendar_id": "string (default: primary)",
  "time_min":    "ISO 8601 (default: now)",
  "time_max":    "ISO 8601 (default: now + 7 days)",
  "max_results": "integer 1–250 (default: 25)"
}
```
**Output:** `CalendarEvent[]`

---

### `google_calendar_create_event`
Create a new calendar event with optional attendees, room, Meet link, and description.

**Input:**
```json
{
  "title":            "string (required)",
  "start":            "ISO 8601 (required)",
  "end":              "ISO 8601 (required)",
  "description":      "string | null",
  "attendees":        "string[] (email addresses)",
  "room_resource_email": "string | null",
  "add_meet_link":    "boolean (default: false)",
  "timezone":         "IANA timezone string (default: connection config timezone)"
}
```
**Output:** Created `CalendarEvent`

---

### `google_calendar_check_availability`
Check free/busy for one or more attendees over a time range.

**Input:**
```json
{
  "emails":    "string[] (required, 1–50)",
  "time_min":  "ISO 8601 (required)",
  "time_max":  "ISO 8601 (required)"
}
```
**Output:** `FreeBusy[]` — one entry per email with their busy slots.

---

### `google_calendar_list_available_rooms`
Query meeting room resources and filter by availability.

**Input:**
```json
{
  "time_min":        "ISO 8601 (required)",
  "time_max":        "ISO 8601 (required)",
  "min_capacity":    "integer | null"
}
```
**Output:** `Room[]` — only rooms with `available: true` (and meeting capacity constraint if provided).

**Implementation note:** Uses Google Admin SDK Directory API (`resources.calendars.list`) + FreeBusy API to cross-check room resource emails. Requires `admin.directory.resource.calendar.readonly` scope if the connected account has Workspace admin rights; gracefully return empty list with a `reason` field if scope is absent.

---

## 5. Business Rules

1. `time_max − time_min` must be ≤ **60 days** for list/availability calls.
2. `google_calendar_check_availability` batches all emails into a single FreeBusy API request (do not loop per-email).
3. Event `end` must be after `end`. Minimum duration: **1 minute**.
4. If `add_meet_link: true`, set `conferenceData.createRequest` on the API call with a generated `requestId`.
5. `room_resource_email` is validated against `google_calendar_list_available_rooms` results before event creation — reject if room is busy in the requested slot.
6. Tokens refreshed proactively when `expiry − now < 5 minutes`.
7. All tool calls validate OAuth token presence first; return a typed `UNAUTHENTICATED` error if missing.

---

## 6. Error Handling

| Scenario | Error Code | Response |
|---|---|---|
| No OAuth token / expired + refresh failed | `UNAUTHENTICATED` | 401 wrapper |
| Google API 403 (insufficient scope) | `PERMISSION_DENIED` | 403 + required scope listed |
| Google API 429 (rate limit) | `RATE_LIMITED` | 429 + `retry_after_seconds` |
| `time_max − time_min > 60 days` | `INVALID_ARGUMENT` | 400 + message |
| Room busy at requested slot | `CONFLICT` | 409 + `busy_slots` returned |
| Google API 5xx | `UPSTREAM_ERROR` | 502 — do NOT leak raw Google error body |
| Event end ≤ start | `INVALID_ARGUMENT` | 400 + message |

All errors follow the project's `Result<T, E>` pattern with `_tag` discriminant. Never throw; wrap at service boundary.

---

## 7. Acceptance Criteria

**List Events**
- **Given** valid OAuth token + calendar has 3 events in next 7 days
- **When** `google_calendar_list_events` called with defaults
- **Then** returns array of 3 `CalendarEvent` objects with all fields populated

**Create Event**
- **Given** valid token, two attendees with no conflicts, available room
- **When** `google_calendar_create_event` called with `add_meet_link: true`
- **Then** returns created event with a non-null `meeting_link`

**Check Availability**
- **Given** attendee A is busy 10:00–11:00, attendee B is free all day
- **When** `google_calendar_check_availability` called for 09:00–12:00
- **Then** returns A with one busy slot, B with empty busy_slots array

**Room Listing**
- **Given** two rooms: one booked, one free in the requested window
- **When** `google_calendar_list_available_rooms` called
- **Then** returns only the free room

**Conflict Guard**
- **Given** room is busy in the requested slot
- **When** `google_calendar_create_event` called with that room
- **Then** returns `CONFLICT` error with the conflicting busy slots — event NOT created

**Token Expiry**
- **Given** access token expires in 3 minutes
- **When** any tool is called
- **Then** token is refreshed automatically before the Google API call proceeds
