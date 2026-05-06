// ── DOM Elements ─────────────────────────────────────────────────────────

const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
const statusBar = document.getElementById("status-bar") as HTMLDivElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const titleInput = document.getElementById("meeting-title") as HTMLInputElement;
const captureModeSelect = document.getElementById("capture-mode") as HTMLSelectElement;
const resultEl = document.getElementById("result") as HTMLDivElement;

let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime: number | null = null;

// Microphone recording happens directly in the popup
let micRecorder: MediaRecorder | null = null;
let micChunks: Blob[] = [];
let micStream: MediaStream | null = null;
let currentMeetingTitle = "";
let currentMeetingUrl = "";
let currentStartTime = "";

const MCP_SERVER_URL = "http://localhost:3101";

// ── Microphone permission ─────────────────────────────────────────────────

async function checkMicPermission() {
  try {
    const permStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (permStatus.state === "granted") return;
    // Not granted — open the permissions page in a new tab
    openPermissionsPage();
  } catch {
    // permissions.query not supported — try getUserMedia directly
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      openPermissionsPage();
    }
  }
}

function openPermissionsPage() {
  const url = chrome.runtime.getURL("permissions.html");
  chrome.tabs.create({ url });
}

// ── Init ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // Request microphone permission immediately on popup open
  checkMicPermission();

  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (response?.state?.isRecording) {
      recordingStartTime = new Date(response.state.startTime).getTime();
      titleInput.value = response.state.meetingTitle || "";
      setRecordingUI();
    } else {
      setIdleUI();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.title && !titleInput.value) {
          titleInput.value = cleanTabTitle(tabs[0].title);
        }
      });
    }
  });

  // Check if we have an active mic recording stored in session
  chrome.storage.session.get("micRecordingActive", (data) => {
    if (data.micRecordingActive) {
      // Popup was reopened while recording — show recording UI
      // but mic stream is lost, so show a warning
      recordingStartTime = new Date(data.micRecordingActive.startTime).getTime();
      titleInput.value = data.micRecordingActive.meetingTitle || "";
      setRecordingUI();
    }
  });
});

toggleBtn.addEventListener("click", () => {
  if (toggleBtn.classList.contains("btn-start")) {
    startRecording();
  } else if (toggleBtn.classList.contains("btn-stop")) {
    stopRecording();
  }
});

// ── System Audio (BlackHole + Mic) ───────────────────────────────────────

async function createSystemAudioStream(): Promise<MediaStream> {
  // Must request mic permission first — otherwise enumerateDevices() returns empty labels
  const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  tempStream.getTracks().forEach((t) => t.stop());

  // Now enumerate devices — labels will be populated after permission grant
  const devices = await navigator.mediaDevices.enumerateDevices();
  const blackhole = devices.find(
    (d) => d.kind === "audioinput" && d.label.toLowerCase().includes("blackhole")
  );

  if (!blackhole) {
    throw new Error(
      "BlackHole not found. Install it with: brew install blackhole-2ch\n" +
      "Then create a Multi-Output Device in Audio MIDI Setup (see README)."
    );
  }

  // Get BlackHole stream (system audio — other participants' voices)
  const systemStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: blackhole.deviceId } },
  });

  // Get default mic stream (your voice)
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  // Merge both streams using Web Audio API
  const audioCtx = new AudioContext();
  const destination = audioCtx.createMediaStreamDestination();

  const systemSource = audioCtx.createMediaStreamSource(systemStream);
  const micSource = audioCtx.createMediaStreamSource(micStream);

  systemSource.connect(destination);
  micSource.connect(destination);

  // Store references for cleanup
  const mergedStream = destination.stream;
  // Attach original streams so we can stop all tracks on recording stop
  (mergedStream as any).__sourceStreams = [systemStream, micStream];
  (mergedStream as any).__audioContext = audioCtx;

  return mergedStream;
}

// ── Recording controls ───────────────────────────────────────────────────

async function startRecording() {
  toggleBtn.disabled = true;
  resultEl.style.display = "none";

  const captureMode = captureModeSelect.value;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentMeetingTitle = titleInput.value || tab?.title || "Untitled Meeting";
    currentMeetingUrl = tab?.url || "";
    currentStartTime = new Date().toISOString();

    if (captureMode === "microphone" || captureMode === "system") {
      // Record directly in the popup using getUserMedia
      try {
        if (captureMode === "system") {
          // System Audio + Mic mode — merge BlackHole (system audio) + mic
          micStream = await createSystemAudioStream();
        } else {
          // Microphone only mode
          micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
        }
      } catch (err) {
        const msg = String(err);
        if (msg.includes("BlackHole")) {
          showError(msg);
        } else {
          showError(`Microphone access denied. Opening setup page...`);
          openPermissionsPage();
        }
        setIdleUI();
        return;
      }

      micChunks = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      micRecorder = new MediaRecorder(micStream, { mimeType });
      micRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) micChunks.push(e.data);
      };
      micRecorder.start(1000);

      recordingStartTime = Date.now();

      // Update badge via background
      chrome.runtime.sendMessage({
        type: "SET_RECORDING_STATE",
        state: {
          isRecording: true,
          startTime: currentStartTime,
          meetingTitle: currentMeetingTitle,
          meetingUrl: currentMeetingUrl,
        },
      });

      // Store in session so reopened popup knows we're recording
      chrome.storage.session.set({
        micRecordingActive: {
          startTime: currentStartTime,
          meetingTitle: currentMeetingTitle,
        },
      });

      setRecordingUI();
    } else {
      // Tab capture mode — delegate to background + offscreen
      let streamId: string | null = null;
      if (tab?.id) {
        try {
          streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
        } catch (err) {
          showError(`Tab capture failed: ${String(err)}`);
          setIdleUI();
          return;
        }
      }

      chrome.runtime.sendMessage(
        {
          type: "START_RECORDING",
          meetingTitle: currentMeetingTitle,
          meetingUrl: currentMeetingUrl,
          tabId: tab?.id,
          captureMode: "tab",
          streamId,
        },
        (response) => {
          if (response?.type === "RECORDING_STARTED") {
            recordingStartTime = new Date(response.startTime).getTime();
            setRecordingUI();
          } else {
            showError(response?.error || "Failed to start recording");
            setIdleUI();
          }
        }
      );
    }
  } catch (err) {
    showError(`Failed to start: ${String(err)}`);
    setIdleUI();
  }
}

async function stopRecording() {
  toggleBtn.disabled = true;
  setUploadingUI();

  if (micRecorder && micRecorder.state !== "inactive") {
    // Stop microphone / system audio recording (popup-based)
    micRecorder.stop();
    // Clean up all source streams (including BlackHole + mic for system mode)
    if (micStream) {
      const sourceStreams = (micStream as any).__sourceStreams as MediaStream[] | undefined;
      const audioCtx = (micStream as any).__audioContext as AudioContext | undefined;
      if (sourceStreams) {
        sourceStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      }
      micStream.getTracks().forEach((t) => t.stop());
      if (audioCtx) audioCtx.close().catch(() => {});
    }

    // Wait for final data
    await new Promise<void>((resolve) => {
      micRecorder!.onstop = () => resolve();
    });

    const audioBlob = new Blob(micChunks, { type: micRecorder.mimeType });
    const endTime = new Date().toISOString();

    micRecorder = null;
    micChunks = [];
    micStream = null;

    // Clear recording state
    chrome.runtime.sendMessage({
      type: "SET_RECORDING_STATE",
      state: { isRecording: false, startTime: null, meetingTitle: null, meetingUrl: null },
    });
    chrome.storage.session.remove("micRecordingActive");

    // Upload
    await uploadAudio(audioBlob, currentMeetingTitle, currentMeetingUrl, currentStartTime, endTime);
    stopTimer();
    setIdleUI();
  } else {
    // Tab capture mode — delegate to background
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, (response) => {
      stopTimer();
      if (response?.uploaded) {
        showSuccess(`Transcript saved! ID: ${response.transcriptId || "processing..."}`);
      } else {
        showError(response?.error || "Upload failed");
      }
      setIdleUI();
    });
  }
}

async function uploadAudio(blob: Blob, title: string, url: string, startTime: string, endTime: string) {
  try {
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    formData.append("meetingTitle", title);
    formData.append("meetingUrl", url);
    formData.append("startTime", startTime);
    formData.append("endTime", endTime);

    const response = await fetch(`${MCP_SERVER_URL}/api/audio/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      showError(`Upload failed: HTTP ${response.status} — ${errorText.slice(0, 200)}`);
      return;
    }

    const result = (await response.json()) as { id?: string };
    showSuccess(`Transcript saved! ID: ${result.id || "processing..."}`);
  } catch (error) {
    showError(`Upload failed: ${String(error)}. Is the MCP server running?`);
  }
}

// ── UI State ─────────────────────────────────────────────────────────────

function setIdleUI() {
  toggleBtn.disabled = false;
  toggleBtn.textContent = "Start Recording";
  toggleBtn.className = "btn btn-start";
  titleInput.disabled = false;
  captureModeSelect.disabled = false;
  statusBar.className = "status-bar status-idle";
  statusText.textContent = "Ready";
  timerEl.style.display = "none";
  stopTimer();
}

function setRecordingUI() {
  toggleBtn.disabled = false;
  toggleBtn.textContent = "Stop Recording";
  toggleBtn.className = "btn btn-stop";
  titleInput.disabled = true;
  captureModeSelect.disabled = true;
  statusBar.className = "status-bar status-recording";
  statusText.textContent = "Recording... (keep popup open)";
  timerEl.style.display = "block";
  startTimer();
}

function setUploadingUI() {
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Uploading...";
  toggleBtn.className = "btn btn-uploading";
  statusBar.className = "status-bar status-uploading";
  statusText.textContent = "Uploading & transcribing...";
}

function showSuccess(message: string) {
  resultEl.style.display = "block";
  resultEl.className = "result result-success";
  resultEl.textContent = message;
}

function showError(message: string) {
  resultEl.style.display = "block";
  resultEl.className = "result result-error";
  resultEl.textContent = message;
}

// ── Timer ────────────────────────────────────────────────────────────────

function startTimer() {
  stopTimer();
  updateTimerDisplay();
  timerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateTimerDisplay() {
  if (!recordingStartTime) return;
  const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  timerEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function cleanTabTitle(title: string): string {
  return title
    .replace(/\s*[-–—|]\s*Google Meet$/i, "")
    .replace(/\s*[-–—|]\s*Zoom$/i, "")
    .replace(/\s*[-–—|]\s*Microsoft Teams$/i, "")
    .trim();
}
