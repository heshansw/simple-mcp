// ── Types ────────────────────────────────────────────────────────────────

type RecordingState = {
  isRecording: boolean;
  startTime: string | null;
  meetingTitle: string | null;
  meetingUrl: string | null;
  tabId: number | null;
};

// ── State ────────────────────────────────────────────────────────────────

let currentState: RecordingState = {
  isRecording: false,
  startTime: null,
  meetingTitle: null,
  meetingUrl: null,
  tabId: null,
};

const MCP_SERVER_URL = "http://localhost:3101";

// ── Message handler ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: any, _sender: any, sendResponse: any) => {
    if (message.type === "START_RECORDING") {
      startRecording(message.meetingTitle)
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

    if (message.type === "MEETING_DETECTED") {
      currentState.meetingUrl = message.url;
      if (!currentState.meetingTitle) {
        currentState.meetingTitle = message.title;
      }
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

// ── Recording logic ──────────────────────────────────────────────────────

async function startRecording(
  meetingTitle?: string
): Promise<{ type: string; startTime?: string; error?: string }> {
  if (currentState.isRecording) {
    return { type: "ERROR", error: "Already recording" };
  }

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return { type: "ERROR", error: "No active tab found" };
    }

    // Get a media stream ID for the tab (MV3 way)
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });

    if (!streamId) {
      return { type: "ERROR", error: "Failed to get media stream ID. Make sure you clicked the extension icon while on the meeting tab." };
    }

    // Create offscreen document for MediaRecorder
    await ensureOffscreenDocument();

    // Tell offscreen document to start recording
    const result = await chrome.runtime.sendMessage({
      type: "OFFSCREEN_START_RECORDING",
      streamId,
    });

    if (!result?.success) {
      return { type: "ERROR", error: result?.error || "Offscreen recording failed to start" };
    }

    const startTime = new Date().toISOString();
    currentState = {
      isRecording: true,
      startTime,
      meetingTitle: meetingTitle || tab.title || "Untitled Meeting",
      meetingUrl: tab.url || null,
      tabId: tab.id,
    };

    // Update badge
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
  uploaded?: boolean;
  transcriptId?: string;
  error?: string;
}> {
  if (!currentState.isRecording) {
    return { type: "ERROR", error: "Not currently recording" };
  }

  try {
    const endTime = new Date().toISOString();
    const savedState = { ...currentState };

    // Tell offscreen document to stop and get the audio data
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
    };

    await chrome.action.setBadgeText({ text: "" });
    await chrome.storage.local.remove("recordingState");

    if (!result?.success) {
      return { type: "RECORDING_STOPPED", uploaded: false, error: result?.error || "Failed to get recording data" };
    }

    // Convert array back to Blob
    const audioData = new Uint8Array(result.buffer);
    const audioBlob = new Blob([audioData], { type: result.mimeType || "audio/webm" });

    // Upload to MCP server
    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("meetingTitle", savedState.meetingTitle || "Untitled Meeting");
      formData.append("meetingUrl", savedState.meetingUrl || "");
      formData.append("startTime", savedState.startTime || endTime);
      formData.append("endTime", endTime);

      const response = await fetch(`${MCP_SERVER_URL}/api/audio/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return {
          type: "RECORDING_STOPPED",
          uploaded: false,
          error: `Upload failed: HTTP ${response.status} — ${errorText.slice(0, 200)}`,
        };
      }

      const uploadResult = (await response.json()) as { id?: string };
      return {
        type: "RECORDING_STOPPED",
        uploaded: true,
        transcriptId: uploadResult.id,
      };
    } catch (error) {
      return {
        type: "RECORDING_STOPPED",
        uploaded: false,
        error: `Upload failed: ${String(error)}. Is the MCP server running on ${MCP_SERVER_URL}?`,
      };
    }
  } catch (error) {
    return { type: "ERROR", error: `Stop recording failed: ${String(error)}` };
  }
}

// ── Restore state on service worker wake ──────────────────────────────

chrome.storage.local.get("recordingState", (result) => {
  if (result.recordingState?.isRecording) {
    chrome.action.setBadgeText({ text: "" });
    chrome.storage.local.remove("recordingState");
  }
});
