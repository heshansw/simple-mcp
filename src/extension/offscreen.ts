// Offscreen document — handles MediaRecorder for microphone, tab capture, and system audio (BlackHole)

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

async function createSystemAudioStream(): Promise<MediaStream> {
  // Request mic permission first so enumerateDevices() returns labels
  const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  tempStream.getTracks().forEach((t) => t.stop());

  const devices = await navigator.mediaDevices.enumerateDevices();
  const blackhole = devices.find(
    (d) => d.kind === "audioinput" && d.label.toLowerCase().includes("blackhole"),
  );

  if (!blackhole) {
    throw new Error(
      "BlackHole not found. Install it with: brew install blackhole-2ch\n" +
        "Then create a Multi-Output Device in Audio MIDI Setup (see README).",
    );
  }

  // BlackHole stream (system audio — other participants' voices)
  const systemStream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: blackhole.deviceId } },
  });

  // Default mic stream (your voice)
  const micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  // Merge both streams using Web Audio API
  audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  const systemSource = audioContext.createMediaStreamSource(systemStream);
  const micSource = audioContext.createMediaStreamSource(micStream);

  systemSource.connect(destination);
  micSource.connect(destination);

  // Keep references for cleanup
  sourceStreams = [systemStream, micStream];

  return destination.stream;
}

async function startRecording(captureMode: string, streamId?: string): Promise<void> {
  let stream: MediaStream;

  if (captureMode === "tab" && streamId) {
    // Tab capture mode — use the streamId from tabCapture.getMediaStreamId
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      } as any,
    });
  } else if (captureMode === "system") {
    // System audio mode — merge BlackHole (system audio) + default mic
    stream = await createSystemAudioStream();
  } else {
    // Microphone mode — captures system microphone input
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

  mediaRecorder.start(1000);
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

      // Clean up BlackHole/mic source streams and AudioContext
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
