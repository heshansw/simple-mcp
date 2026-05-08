// Offscreen document — handles MediaRecorder for microphone, tab capture, and tab+mic combined mode
// Uploads audio chunks directly to the MCP server (bypasses chrome.runtime.sendMessage size limits)

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let audioContext: AudioContext | null = null;
let sourceStreams: MediaStream[] = [];
let stoppedByTrackEnd = false;

// Chunked upload state
let serverUrl = "";
let sessionId = "";
let chunkIndex = 0;
let pendingChunks: Blob[] = [];
let uploadInterval: ReturnType<typeof setInterval> | null = null;
const CHUNK_UPLOAD_INTERVAL_MS = 60_000; // Upload every 60 seconds

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_RECORDING") {
    const mode = message.captureMode || "microphone";
    serverUrl = message.serverUrl || "http://localhost:3101";
    sessionId = message.sessionId || "";

    startRecording(mode, message.streamId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "OFFSCREEN_STOP_RECORDING") {
    stopRecording()
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "OFFSCREEN_GET_STATUS") {
    sendResponse({
      isRecording: mediaRecorder !== null && mediaRecorder.state === "recording",
    });
    return true;
  }

  return false;
});

// ── Chunk upload helpers ────────────────────────────────────────────────

async function uploadPendingChunks(): Promise<void> {
  if (pendingChunks.length === 0 || !sessionId) return;

  const chunksToUpload = pendingChunks.splice(0);
  const blob = new Blob(chunksToUpload, { type: mediaRecorder?.mimeType || "audio/webm" });

  const formData = new FormData();
  formData.append("chunk", blob, `chunk-${chunkIndex}.webm`);
  formData.append("chunkIndex", String(chunkIndex));

  try {
    const response = await fetch(`${serverUrl}/api/audio/sessions/${sessionId}/chunks`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      console.error(`Chunk upload failed: HTTP ${response.status}`);
      return;
    }

    chunkIndex++;
  } catch (error) {
    console.error("Chunk upload error:", error);
    // Re-add chunks to pending on failure so they're included in the next upload
    pendingChunks.unshift(...chunksToUpload);
  }
}

function startChunkUploadInterval(): void {
  stopChunkUploadInterval();
  uploadInterval = setInterval(() => {
    uploadPendingChunks().catch(console.error);
  }, CHUNK_UPLOAD_INTERVAL_MS);
}

function stopChunkUploadInterval(): void {
  if (uploadInterval) {
    clearInterval(uploadInterval);
    uploadInterval = null;
  }
}

async function finalizeSession(): Promise<{ success: boolean; jobId?: string; error?: string }> {
  if (!sessionId) {
    return { success: false, error: "No active session" };
  }

  try {
    const response = await fetch(`${serverUrl}/api/audio/sessions/${sessionId}/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endTime: new Date().toISOString() }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return { success: false, error: `Finalize failed: HTTP ${response.status} — ${errorText.slice(0, 200)}` };
    }

    const result = await response.json() as { jobId?: string };
    // Server returns immediately (202) — transcription runs in background
    return { success: true, jobId: result.jobId };
  } catch (error) {
    return { success: false, error: `Finalize failed: ${String(error)}` };
  }
}

// ── Recording ───────────────────────────────────────────────────────────

async function startRecording(captureMode: string, streamId?: string): Promise<void> {
  let stream: MediaStream;

  if ((captureMode === "tab" || captureMode === "tab+mic") && streamId) {
    // Capture tab audio via the streamId from tabCapture.getMediaStreamId
    const tabStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as any,
    });

    // Listen for unexpected track end (e.g., tab closed/navigated)
    for (const track of tabStream.getAudioTracks()) {
      track.onended = () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          stoppedByTrackEnd = true;
          mediaRecorder.stop();
        }
      };
    }

    // Set up AudioContext to pipe tab audio back to speakers
    audioContext = new AudioContext();
    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(audioContext.destination);

    if (captureMode === "tab+mic") {
      // Also capture mic and merge both streams
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,  // Must be false — echo cancellation removes the other participant's voice
          noiseSuppression: true,
          autoGainControl: false,   // We control gain manually for proper balance
        },
      });

      // Merge tab + mic into a single stream with gain balancing
      const destination = audioContext.createMediaStreamDestination();

      // Boost tab audio (other participant is quieter via WebRTC)
      const tabGain = audioContext.createGain();
      tabGain.gain.value = 1.8;
      tabSource.connect(tabGain);
      tabGain.connect(destination);

      // Slightly reduce mic (user's voice is naturally louder, close to mic)
      const micGain = audioContext.createGain();
      micGain.gain.value = 0.8;
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(micGain);
      micGain.connect(destination);

      sourceStreams = [tabStream, micStream];
      stream = destination.stream;
    } else {
      // Tab-only mode — record the tab stream directly
      stream = tabStream;
    }
  } else {
    // Microphone-only mode
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        sampleRate: 48000,
      },
    });
  }

  recordedChunks = [];
  pendingChunks = [];
  chunkIndex = 0;

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
      pendingChunks.push(event.data);
    }
  };

  // Start periodic chunk uploads if we have a session
  if (sessionId) {
    startChunkUploadInterval();
  }

  // MediaStreamDestination (tab+mic merged) can produce corrupt headers with timeslice,
  // so only use timeslice for direct stream modes (tab-only, mic-only)
  if (captureMode === "tab+mic") {
    mediaRecorder.start();
  } else {
    mediaRecorder.start(1000);
  }
}

async function stopRecording(): Promise<{ success: boolean; jobId?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error("Not recording"));
      return;
    }

    mediaRecorder.onstop = async () => {
      // Stop the main recording stream tracks
      mediaRecorder!.stream.getTracks().forEach((track) => track.stop());

      // Clean up source streams (tab + mic for combined mode)
      for (const s of sourceStreams) {
        s.getTracks().forEach((t) => t.stop());
      }
      sourceStreams = [];
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }

      stopChunkUploadInterval();

      const wasTrackEnd = stoppedByTrackEnd;
      const mimeType = mediaRecorder!.mimeType;
      mediaRecorder = null;
      stoppedByTrackEnd = false;

      if (sessionId) {
        // Chunked mode: upload remaining chunks and finalize
        try {
          await uploadPendingChunks();
          const result = await finalizeSession();

          // Reset state
          recordedChunks = [];
          pendingChunks = [];
          sessionId = "";

          if (wasTrackEnd) {
            chrome.runtime.sendMessage({
              type: "RECORDING_ENDED_UNEXPECTEDLY",
              uploaded: result.success,
              jobId: result.jobId,
              error: result.error,
            });
          }

          resolve(result);
        } catch (error) {
          recordedChunks = [];
          pendingChunks = [];
          sessionId = "";
          resolve({ success: false, error: String(error) });
        }
      } else {
        // Legacy mode (no session): send audio buffer via message
        // Only used for microphone-only recordings from popup
        const blob = new Blob(recordedChunks, { type: mimeType });
        recordedChunks = [];
        pendingChunks = [];

        if (wasTrackEnd) {
          blob.arrayBuffer().then((buffer) => {
            chrome.runtime.sendMessage({
              type: "RECORDING_ENDED_UNEXPECTEDLY",
              buffer: Array.from(new Uint8Array(buffer)),
              mimeType: blob.type,
              sizeBytes: buffer.byteLength,
            });
          });
          resolve({ success: true });
        } else {
          blob.arrayBuffer().then((buffer) => {
            resolve({
              success: true,
              buffer: Array.from(new Uint8Array(buffer)),
              mimeType: blob.type,
              sizeBytes: buffer.byteLength,
            } as any);
          });
        }
      }
    };

    mediaRecorder.stop();
  });
}
