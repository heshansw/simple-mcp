// ── Types ────────────────────────────────────────────────────────────────

type RecordingState = {
  isRecording: boolean;
  startTime: string | null;
  meetingTitle: string | null;
  meetingUrl: string | null;
  tabId: number | null;
  sessionId: string | null;
  attendees: string[];
};

// ── State ────────────────────────────────────────────────────────────────

let currentState: RecordingState = {
  isRecording: false,
  startTime: null,
  meetingTitle: null,
  meetingUrl: null,
  tabId: null,
  sessionId: null,
  attendees: [],
};

const MCP_SERVER_URL = "http://localhost:3101";

// ── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: any, _sender: any, sendResponse: any) => {
    // Ignore messages intended for the offscreen document — returning false
    // for these would close the message channel before offscreen can respond.
    if (message.type?.startsWith("OFFSCREEN_")) {
      return false;
    }

    if (message.type === "START_RECORDING") {
      startRecording(message.captureMode, message.meetingTitle, message.meetingUrl, message.tabId)
        .then((result: any) => sendResponse(result))
        .catch((err: any) => sendResponse({ type: "ERROR", error: String(err) }));
      return true;
    }

    if (message.type === "STOP_RECORDING") {
      stopRecording()
        .then((result: any) => sendResponse(result))
        .catch((err: any) => sendResponse({ type: "ERROR", error: String(err) }));
      return true;
    }

    if (message.type === "GET_STATUS") {
      sendResponse({ type: "STATUS", state: currentState });
      return false;
    }

    if (message.type === "SET_RECORDING_STATE") {
      currentState = { ...currentState, ...message.state };
      if (message.state.isRecording) {
        chrome.action.setBadgeText({ text: "REC" });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      } else {
        chrome.action.setBadgeText({ text: "" });
      }
      sendResponse({ type: "OK" });
      return false;
    }

    if (message.type === "MEETING_DETECTED") {
      currentState.meetingUrl = message.url;
      if (!currentState.meetingTitle) {
        currentState.meetingTitle = message.title;
      }
      return false;
    }

    if (message.type === "MEETING_ATTENDEES") {
      // Merge new attendees with existing list (deduplicate)
      const existing = new Set(currentState.attendees);
      for (const name of message.attendees || []) {
        existing.add(name);
      }
      currentState.attendees = [...existing];
      return false;
    }

    if (message.type === "RECORDING_ENDED_UNEXPECTEDLY") {
      handleUnexpectedEnd(message).catch(() => {});
      return false;
    }

    return false;
  }
);

// ── Offscreen document management ────────────────────────────────────────

async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Recording tab audio for meeting transcription",
  });
}

// ── Session management ──────────────────────────────────────────────────

async function createAudioSession(
  meetingTitle: string,
  meetingUrl: string,
  startTime: string,
  attendees: string[],
): Promise<string> {
  const response = await fetch(`${MCP_SERVER_URL}/api/audio/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meetingTitle, meetingUrl, startTime, attendees }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: HTTP ${response.status}`);
  }

  const session = await response.json() as { id: string };
  return session.id;
}

// ── Recording logic ──────────────────────────────────────────────────────

async function startRecording(
  captureMode: string,
  meetingTitle?: string,
  meetingUrl?: string,
  tabId?: number
): Promise<{ type: string; startTime?: string; error?: string }> {
  if (currentState.isRecording) {
    return { type: "ERROR", error: "Already recording" };
  }

  try {
    // Create offscreen document for MediaRecorder
    await ensureOffscreenDocument();

    // Clean up any stale streams from a previous recording that wasn't properly stopped
    try {
      const status = await chrome.runtime.sendMessage({ type: "OFFSCREEN_GET_STATUS" });
      if (status?.isRecording) {
        await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP_RECORDING" });
      }
    } catch { /* offscreen may not exist yet or not be recording */ }

    // For tab-based modes, obtain the streamId here in the service worker
    let streamId: string | undefined;
    if ((captureMode === "tab" || captureMode === "tab+mic") && tabId) {
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tabId,
      });
    }

    const startTime = new Date().toISOString();
    const resolvedTitle = meetingTitle || "Untitled Meeting";
    const resolvedUrl = meetingUrl || "";

    // Create a server-side session for chunked uploads
    let sessionId = "";
    try {
      sessionId = await createAudioSession(resolvedTitle, resolvedUrl, startTime, currentState.attendees);
    } catch (error) {
      // Session creation failed — recording can still work but won't use chunked upload
      console.error("Failed to create audio session:", error);
    }

    // Tell offscreen document to start recording
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_START_RECORDING",
      captureMode,
      streamId,
      serverUrl: MCP_SERVER_URL,
      sessionId,
    });

    if (!result?.success) {
      return { type: "ERROR", error: result?.error || "Offscreen recording failed to start" };
    }

    currentState = {
      isRecording: true,
      startTime,
      meetingTitle: resolvedTitle,
      meetingUrl: resolvedUrl,
      tabId: tabId || null,
      sessionId,
      attendees: currentState.attendees,
    };

    await chrome.action.setBadgeText({ text: "REC" });
    await chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    await chrome.storage.local.set({ recordingState: currentState });

    return { type: "RECORDING_STARTED", startTime };
  } catch (error) {
    return { type: "ERROR", error: `Failed to start recording: ${String(error)}` };
  }
}

async function stopRecording(): Promise<{
  type: string;
  jobId?: string;
  error?: string;
}> {
  if (!currentState.isRecording) {
    return { type: "ERROR", error: "Not currently recording" };
  }

  try {
    // Tell offscreen document to stop — it uploads remaining chunks and triggers finalize
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_STOP_RECORDING",
    });

    // Reset state
    currentState = {
      isRecording: false,
      startTime: null,
      meetingTitle: null,
      meetingUrl: null,
      tabId: null,
      sessionId: null,
      attendees: [],
    };

    await chrome.action.setBadgeText({ text: "" });
    await chrome.storage.local.remove("recordingState");

    if (result?.success && result.jobId) {
      // Store active job for popup polling
      const stored = await chrome.storage.local.get("activeJobs");
      const activeJobs: string[] = stored.activeJobs || [];
      if (!activeJobs.includes(result.jobId)) {
        activeJobs.push(result.jobId);
      }
      await chrome.storage.local.set({ activeJobs });

      return { type: "RECORDING_STOPPED", jobId: result.jobId };
    }

    return {
      type: "RECORDING_STOPPED",
      error: result?.error || "Failed to process recording",
    };
  } catch (error) {
    return { type: "ERROR", error: `Stop recording failed: ${String(error)}` };
  }
}

// ── Handle unexpected recording end (tab closed, navigated, etc.) ─────

async function handleUnexpectedEnd(message: any): Promise<void> {
  // Reset state — the offscreen document handles upload + finalization directly
  currentState = {
    isRecording: false,
    startTime: null,
    meetingTitle: null,
    meetingUrl: null,
    tabId: null,
    sessionId: null,
    attendees: [],
  };
  await chrome.action.setBadgeText({ text: "" });
  await chrome.storage.local.remove("recordingState");
}

// ── Restore state on service worker wake ──────────────────────────────

chrome.storage.local.get("recordingState", (result) => {
  if (result.recordingState?.isRecording) {
    // Restore in-memory state — offscreen document may still be recording
    currentState = result.recordingState;
    chrome.action.setBadgeText({ text: "REC" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
  }
});
