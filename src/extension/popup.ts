// ── DOM Elements ─────────────────────────────────────────────────────────

const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
const statusBar = document.getElementById("status-bar") as HTMLDivElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const titleInput = document.getElementById("meeting-title") as HTMLInputElement;
const resultEl = document.getElementById("result") as HTMLDivElement;

let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime: number | null = null;

// ── Init ─────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
    if (response?.state?.isRecording) {
      recordingStartTime = new Date(response.state.startTime).getTime();
      titleInput.value = response.state.meetingTitle || "";
      setRecordingUI();
    } else {
      setIdleUI();
      // Auto-populate title from active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.title && !titleInput.value) {
          titleInput.value = cleanTabTitle(tabs[0].title);
        }
      });
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

// ── Recording controls ───────────────────────────────────────────────────

function startRecording() {
  toggleBtn.disabled = true;
  resultEl.style.display = "none";

  chrome.runtime.sendMessage(
    { type: "START_RECORDING", meetingTitle: titleInput.value || undefined },
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

function stopRecording() {
  toggleBtn.disabled = true;
  setUploadingUI();

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

// ── UI State ─────────────────────────────────────────────────────────────

function setIdleUI() {
  toggleBtn.disabled = false;
  toggleBtn.textContent = "Start Recording";
  toggleBtn.className = "btn btn-start";
  titleInput.disabled = false;
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
  statusBar.className = "status-bar status-recording";
  statusText.textContent = "Recording...";
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

// ── Helpers ──────────────────────────────────────────────────────────────

function cleanTabTitle(title: string): string {
  // Remove common meeting platform suffixes
  return title
    .replace(/\s*[-–—|]\s*Google Meet$/i, "")
    .replace(/\s*[-–—|]\s*Zoom$/i, "")
    .replace(/\s*[-–—|]\s*Microsoft Teams$/i, "")
    .trim();
}
