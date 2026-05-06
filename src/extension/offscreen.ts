// Offscreen document — handles MediaRecorder since service workers can't access it in MV3

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "OFFSCREEN_START_RECORDING") {
    startRecording(message.streamId)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  if (message.type === "OFFSCREEN_STOP_RECORDING") {
    stopRecording()
      .then((blob) => {
        // Convert blob to array buffer and send back
        blob.arrayBuffer().then((buffer) => {
          sendResponse({ success: true, buffer: Array.from(new Uint8Array(buffer)), mimeType: blob.type });
        });
      })
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true;
  }

  return false;
});

async function startRecording(streamId: string): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId,
      },
    } as any,
  });

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
