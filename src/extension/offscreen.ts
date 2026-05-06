// Offscreen document — handles MediaRecorder for both microphone and tab capture

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

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
  } else {
    // Microphone mode — captures system microphone input
    // This picks up meeting audio through speakers/headphones + your voice
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
      mediaRecorder!.stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(recordedChunks, { type: mediaRecorder!.mimeType });
      mediaRecorder = null;
      recordedChunks = [];
      resolve(blob);
    };

    mediaRecorder.stop();
  });
}
