// ── DOM Elements ─────────────────────────────────────────────────────────

const toggleBtn = document.getElementById("toggle-btn") as HTMLButtonElement;
const statusBar = document.getElementById("status-bar") as HTMLDivElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const timerEl = document.getElementById("timer") as HTMLDivElement;
const titleInput = document.getElementById("meeting-title") as HTMLInputElement;
const captureModeSelect = document.getElementById("capture-mode") as HTMLSelectElement;
const resultEl = document.getElementById("result") as HTMLDivElement;
const processingSection = document.getElementById("processing-section") as HTMLDivElement;
const processingJobsEl = document.getElementById("processing-jobs") as HTMLDivElement;

let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartTime: number | null = null;
let jobPollInterval: ReturnType<typeof setInterval> | null = null;

// Microphone recording happens directly in the popup
let micRecorder: MediaRecorder | null = null;
let micChunks: Blob[] = [];
let micStream: MediaStream | null = null;
let currentMeetingTitle = "";
let currentMeetingUrl = "";
let currentStartTime = "";

const MCP_SERVER_URL = "http://localhost:3101";
const JOB_POLL_INTERVAL_MS = 3000;

// ── Microphone permission ─────────────────────────────────────────────────

async function checkMicPermission() {
  try {
    const permStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (permStatus.state === "granted") return;
    openPermissionsPage();
  } catch {
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
      recordingStartTime = new Date(data.micRecordingActive.startTime).getTime();
      titleInput.value = data.micRecordingActive.meetingTitle || "";
      setRecordingUI();
    }
  });

  // Start polling for active processing jobs
  startJobPolling();
});

toggleBtn.addEventListener("click", () => {
  if (toggleBtn.classList.contains("btn-start")) {
    startRecording();
  } else if (toggleBtn.classList.contains("btn-stop")) {
    stopRecording();
  }
});

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

    if (captureMode === "microphone") {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } catch {
        showError(`Microphone access denied. Opening setup page...`);
        openPermissionsPage();
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

      chrome.runtime.sendMessage({
        type: "SET_RECORDING_STATE",
        state: {
          isRecording: true,
          startTime: currentStartTime,
          meetingTitle: currentMeetingTitle,
          meetingUrl: currentMeetingUrl,
        },
      });

      chrome.storage.session.set({
        micRecordingActive: {
          startTime: currentStartTime,
          meetingTitle: currentMeetingTitle,
        },
      });

      setRecordingUI();
    } else {
      chrome.runtime.sendMessage(
        {
          type: "START_RECORDING",
          meetingTitle: currentMeetingTitle,
          meetingUrl: currentMeetingUrl,
          tabId: tab?.id,
          captureMode,
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
    micRecorder.stop();

    await new Promise<void>((resolve) => {
      micRecorder!.onstop = () => resolve();
    });

    const audioBlob = new Blob(micChunks, { type: micRecorder.mimeType });

    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
    }
    const endTime = new Date().toISOString();

    micRecorder = null;
    micChunks = [];
    micStream = null;

    chrome.runtime.sendMessage({
      type: "SET_RECORDING_STATE",
      state: { isRecording: false, startTime: null, meetingTitle: null, meetingUrl: null },
    });
    chrome.storage.session.remove("micRecordingActive");

    await uploadAudio(audioBlob, currentMeetingTitle, currentMeetingUrl, currentStartTime, endTime);
    stopTimer();
    setIdleUI();
  } else {
    // Tab capture mode — delegate to background
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" }, (response) => {
      stopTimer();
      if (response?.jobId) {
        showSuccess("Recording saved. Transcription processing in background...");
        // Polling will pick up the job automatically
        pollJobs();
      } else if (response?.error) {
        showError(response.error);
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

// ── Processing jobs polling ─────────────────────────────────────────────

function startJobPolling() {
  pollJobs();
  if (jobPollInterval) clearInterval(jobPollInterval);
  jobPollInterval = setInterval(pollJobs, JOB_POLL_INTERVAL_MS);
}

async function pollJobs() {
  try {
    // Get active job IDs from storage
    const stored = await chrome.storage.local.get("activeJobs");
    const activeJobIds: string[] = stored.activeJobs || [];

    if (activeJobIds.length === 0) {
      // Also check if server has any active jobs (handles popup reopened after extension reload)
      try {
        const response = await fetch(`${MCP_SERVER_URL}/api/audio/jobs`);
        if (response.ok) {
          const allJobs = await response.json() as any[];
          const activeServerJobs = allJobs.filter(
            (j: any) => j.status !== "completed" && j.status !== "failed"
          );
          if (activeServerJobs.length > 0) {
            const ids = activeServerJobs.map((j: any) => j.id);
            await chrome.storage.local.set({ activeJobs: ids });
            renderJobs(allJobs);
            return;
          }
        }
      } catch { /* server not reachable */ }

      processingSection.style.display = "none";
      return;
    }

    // Fetch status for each active job
    const jobs: any[] = [];
    const stillActive: string[] = [];

    for (const jobId of activeJobIds) {
      try {
        const response = await fetch(`${MCP_SERVER_URL}/api/audio/jobs/${jobId}`);
        if (response.ok) {
          const job = await response.json();
          jobs.push(job);
          if (job.status !== "completed" && job.status !== "failed") {
            stillActive.push(jobId);
          } else {
            // Keep completed/failed jobs visible for 30 seconds
            setTimeout(async () => {
              const s = await chrome.storage.local.get("activeJobs");
              const ids: string[] = (s.activeJobs || []).filter((id: string) => id !== jobId);
              await chrome.storage.local.set({ activeJobs: ids });
              pollJobs();
            }, 30_000);
            stillActive.push(jobId); // Keep in list until timeout
          }
        }
      } catch { /* skip unreachable jobs */ }
    }

    renderJobs(jobs);
  } catch {
    // Polling error — ignore
  }
}

function renderJobs(jobs: any[]) {
  if (jobs.length === 0) {
    processingSection.style.display = "none";
    return;
  }

  processingSection.style.display = "block";
  processingJobsEl.innerHTML = "";

  for (const job of jobs) {
    const card = document.createElement("div");
    const statusClass = job.status === "completed" ? "job-completed" : job.status === "failed" ? "job-failed" : "";
    card.className = `job-card ${statusClass}`;

    const progress = getProgressForStatus(job.status, job.progress);
    const statusLabel = getStatusLabel(job);
    const isAnimating = job.status !== "completed" && job.status !== "failed";

    card.innerHTML = `
      <div class="job-title">${escapeHtml(job.meetingTitle || "Meeting")}</div>
      <div class="job-progress-bar">
        <div class="job-progress-fill ${isAnimating ? "animating" : ""}" style="width: ${progress}%"></div>
      </div>
      <div class="job-status">${statusLabel}</div>
    `;

    processingJobsEl.appendChild(card);
  }
}

function getProgressForStatus(status: string, serverProgress: number): number {
  switch (status) {
    case "concatenating": return 10;
    case "converting": return 30;
    case "transcribing": return Math.max(50, serverProgress);
    case "attributing": return 90;
    case "completed": return 100;
    case "failed": return 100;
    default: return serverProgress;
  }
}

function getStatusLabel(job: any): string {
  switch (job.status) {
    case "concatenating": return "Preparing audio...";
    case "converting": return "Converting format...";
    case "transcribing": return "Transcribing with Whisper...";
    case "attributing": return "Identifying speakers...";
    case "completed": {
      const id = job.result?.id || "";
      return `Done${id ? ` — ID: ${id.slice(0, 8)}...` : ""}`;
    }
    case "failed": return `Failed: ${(job.error || "Unknown error").slice(0, 80)}`;
    default: return "Processing...";
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
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
  const mode = captureModeSelect.value;
  statusText.textContent = mode === "microphone"
    ? "Recording... (keep popup open)"
    : "Recording... (you can close this popup)";
  timerEl.style.display = "block";
  startTimer();
}

function setUploadingUI() {
  toggleBtn.disabled = true;
  toggleBtn.textContent = "Stopping...";
  toggleBtn.className = "btn btn-uploading";
  statusBar.className = "status-bar status-uploading";
  statusText.textContent = "Saving recording...";
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
