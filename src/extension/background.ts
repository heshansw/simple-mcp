// ── Types ────────────────────────────────────────────────────────────────

type RecordingState = {
  isRecording: boolean;
  startTime: string | null;
  meetingTitle: string | null;
  meetingUrl: string | null;
  tabId: number | null;
};

type RecordingMessage =
  | { type: "START_RECORDING"; meetingTitle?: string }
  | { type: "STOP_RECORDING" }
  | { type: "GET_STATUS" }
  | { type: "RECORDING_STARTED"; startTime: string }
  | { type: "RECORDING_STOPPED"; uploaded: boolean; error?: string }
  | { type: "STATUS"; state: RecordingState }
  | { type: "MEETING_DETECTED"; title: string; url: string };

// ── State ────────────────────────────────────────────────────────────────

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
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
  (message: RecordingMessage, _sender, sendResponse) => {
    if (message.type === "START_RECORDING") {
      startRecording(message.meetingTitle)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ type: "ERROR", error: String(err) }));
      return true; // async response
    }

    if (message.type === "STOP_RECORDING") {
      stopRecording()
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ type: "ERROR", error: String(err) }));
      return true;
    }

    if (message.type === "GET_STATUS") {
      sendResponse({ type: "STATUS", state: currentState });
      return false;
    }

    if (message.type === "MEETING_DETECTED") {
      // Content script detected a meeting page
      currentState.meetingUrl = message.url;
      if (!currentState.meetingTitle) {
        currentState.meetingTitle = message.title;
      }
      return false;
    }

    return false;
  }
);

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

    // Capture tab audio
    const stream = await chrome.tabCapture.capture({
      audio: true,
      video: false,
    });

    if (!stream) {
      return { type: "ERROR", error: "Failed to capture tab audio. Make sure you clicked the extension icon while on the meeting tab." };
    }

    // Set up MediaRecorder
    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";

    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      // Clean up the stream tracks
      stream.getTracks().forEach((track) => track.stop());
    };

    // Start recording with 1-second timeslice for chunking
    mediaRecorder.start(1000);

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

    // Persist state
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
  if (!currentState.isRecording || !mediaRecorder) {
    return { type: "ERROR", error: "Not currently recording" };
  }

  return new Promise((resolve) => {
    mediaRecorder!.onstop = async () => {
      // Clean up stream
      mediaRecorder!.stream.getTracks().forEach((track) => track.stop());

      const endTime = new Date().toISOString();
      const audioBlob = new Blob(recordedChunks, {
        type: mediaRecorder!.mimeType,
      });

      // Reset state
      const savedState = { ...currentState };
      currentState = {
        isRecording: false,
        startTime: null,
        meetingTitle: null,
        meetingUrl: null,
        tabId: null,
      };
      mediaRecorder = null;
      recordedChunks = [];

      // Clear badge
      await chrome.action.setBadgeText({ text: "" });
      await chrome.storage.local.remove("recordingState");

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
          resolve({
            type: "RECORDING_STOPPED",
            uploaded: false,
            error: `Upload failed: HTTP ${response.status} — ${errorText.slice(0, 200)}`,
          });
          return;
        }

        const result = (await response.json()) as { id?: string };
        resolve({
          type: "RECORDING_STOPPED",
          uploaded: true,
          transcriptId: result.id,
        });
      } catch (error) {
        resolve({
          type: "RECORDING_STOPPED",
          uploaded: false,
          error: `Upload failed: ${String(error)}. Is the MCP server running on ${MCP_SERVER_URL}?`,
        });
      }
    };

    mediaRecorder!.stop();
  });
}

// ── Restore state on service worker wake ──────────────────────────────

chrome.storage.local.get("recordingState", (result) => {
  if (result.recordingState?.isRecording) {
    // Service worker restarted while recording — mark as not recording
    // (the MediaRecorder stream is lost on SW restart)
    chrome.action.setBadgeText({ text: "" });
    chrome.storage.local.remove("recordingState");
  }
});
