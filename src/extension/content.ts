// Content script — runs on Google Meet and Zoom pages
// Detects meeting info and attendees, sends to background service worker

let lastSentTitle = "";
let lastSentUrl = "";
let lastSentAttendees = "";
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let attendeeInterval: ReturnType<typeof setInterval> | null = null;

// ── Meeting info detection ──────────────────────────────────────────────

function detectMeetingInfo() {
  const url = window.location.href;
  let title = "";

  // Google Meet: title is in the page or tab
  if (url.includes("meet.google.com")) {
    const titleEl = document.querySelector("[data-meeting-title]");
    title = titleEl?.textContent?.trim() || document.title.replace(/\s*[-–—|]\s*Google Meet$/i, "").trim();
  }

  // Zoom: extract from page title
  if (url.includes("zoom.us")) {
    title = document.title.replace(/\s*[-–—|]\s*Zoom$/i, "").trim();
  }

  const resolvedTitle = title || "Meeting";

  // Only send if values actually changed
  if (resolvedTitle === lastSentTitle && url === lastSentUrl) return;

  lastSentTitle = resolvedTitle;
  lastSentUrl = url;

  chrome.runtime.sendMessage({
    type: "MEETING_DETECTED",
    title: resolvedTitle,
    url,
  });
}

// ── Attendee detection ──────────────────────────────────────────────────

function detectAttendees(): string[] {
  const url = window.location.href;
  const attendees: string[] = [];

  if (url.includes("meet.google.com")) {
    // Google Meet participant detection
    // Self name from data attribute
    const selfEl = document.querySelector("[data-self-name]");
    if (selfEl) {
      const name = selfEl.getAttribute("data-self-name")?.trim();
      if (name) attendees.push(name);
    }

    // Participants from the people panel / roster
    // Google Meet uses various selectors across versions:
    // - [data-participant-id] containers with name text
    // - .ZjFb7c (participant name class)
    // - [data-requested-participant-id] for roster items
    const participantEls = document.querySelectorAll(
      "[data-participant-id] [data-self-name], " +
      "[data-participant-id] .ZjFb7c, " +
      "[data-requested-participant-id] .ZjFb7c"
    );
    for (const el of participantEls) {
      const name = el.textContent?.trim();
      if (name && !attendees.includes(name)) {
        attendees.push(name);
      }
    }

    // Fallback: look for participant names in aria-labels of video tiles
    if (attendees.length === 0) {
      const tiles = document.querySelectorAll("[data-participant-id]");
      for (const tile of tiles) {
        const ariaLabel = tile.getAttribute("aria-label");
        if (ariaLabel) {
          // aria-label often contains the participant name
          const name = ariaLabel.replace(/\s*\(.*\)$/, "").trim();
          if (name && !attendees.includes(name)) {
            attendees.push(name);
          }
        }
      }
    }
  }

  if (url.includes("zoom.us")) {
    // Zoom Web participant detection
    // Zoom uses various class names that change across versions
    const selectors = [
      ".participants-item__display-name",
      "[class*='participants-item'] [class*='display-name']",
      ".participant-item .participant-name",
    ];

    for (const selector of selectors) {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        const name = el.textContent?.trim();
        if (name && !attendees.includes(name)) {
          attendees.push(name);
        }
      }
      if (attendees.length > 0) break;
    }
  }

  return attendees;
}

function sendAttendeeUpdate() {
  const attendees = detectAttendees();
  if (attendees.length === 0) return;

  // Only send if attendee list changed
  const key = attendees.sort().join("|");
  if (key === lastSentAttendees) return;
  lastSentAttendees = key;

  chrome.runtime.sendMessage({
    type: "MEETING_ATTENDEES",
    attendees,
  });
}

// ── Initialize ──────────────────────────────────────────────────────────

// Detect meeting info once on load
detectMeetingInfo();

// Debounced observer for title changes — check at most once every 5 seconds
const observer = new MutationObserver(() => {
  if (debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    detectMeetingInfo();
  }, 5000);
});

observer.observe(document.head, {
  childList: true,
  subtree: true,
});

// Poll for attendees every 15 seconds (participants join/leave dynamically)
sendAttendeeUpdate();
attendeeInterval = setInterval(sendAttendeeUpdate, 15_000);
