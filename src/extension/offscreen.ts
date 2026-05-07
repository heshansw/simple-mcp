// Offscreen document — handles MediaRecorder for microphone, tab capture, and tab+mic combined mode

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let audioContext: AudioContext | null = null;
let sourceStreams: MediaStream[] = [];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_RECORDING") {
    const mode = message.captureMode || "microphone";
    startRecording(mode, message.streamId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "OFFSCREEN_STOP_RECORDING") {
    stopRecording()
      .then((blob) => {
        blob.arrayBuffer().then((buffer) => {
          sendResponse({
            success: true,
            buffer: Array.from(new Uint8Array(buffer)),
            mimeType: blob.type,
            sizeBytes: buffer.byteLength,
          });
        });
      })
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  return false;
});

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

    // Set up AudioContext to pipe tab audio back to speakers
    audioContext = new AudioContext();
    const tabSource = audioContext.createMediaStreamSource(tabStream);
    tabSource.connect(audioContext.destination);

    if (captureMode === "tab+mic") {
      // Also capture mic and merge both streams
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // Merge tab + mic into a single stream for recording
      const destination = audioContext.createMediaStreamDestination();
      tabSource.connect(destination);
      const micSource = audioContext.createMediaStreamSource(micStream);
      micSource.connect(destination);

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
  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  mediaRecorder = new MediaRecorder(stream, { mimeType });

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };

  // MediaStreamDestination (tab+mic merged) can produce corrupt headers with timeslice,
  // so only use timeslice for direct stream modes (tab-only, mic-only)
  if (captureMode === "tab+mic") {
    mediaRecorder.start();
  } else {
    mediaRecorder.start(1000);
  }
}

async function stopRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error("Not recording"));
      return;
    }

    mediaRecorder.onstop = () => {
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

      const blob = new Blob(recordedChunks, { type: mediaRecorder!.mimeType });
      mediaRecorder = null;
      recordedChunks = [];
      resolve(blob);
    };

    mediaRecorder.stop();
  });
}
