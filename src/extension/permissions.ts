const statusEl = document.getElementById("status") as HTMLDivElement;
const grantBtn = document.getElementById("grant-btn") as HTMLButtonElement;

async function requestMic() {
  statusEl.textContent = "Requesting microphone access...";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    statusEl.textContent = "Microphone access granted! You can close this tab and use the extension.";
    statusEl.className = "status status-granted";
    grantBtn.textContent = "Done — Close Tab";
    grantBtn.onclick = () => window.close();
  } catch (err) {
    statusEl.textContent = `Microphone access denied: ${String(err)}. Click the lock icon in the address bar to change the setting, then try again.`;
    statusEl.className = "status status-denied";
  }
}

grantBtn.addEventListener("click", requestMic);

// Check current state on load
navigator.permissions
  .query({ name: "microphone" as PermissionName })
  .then((result) => {
    if (result.state === "granted") {
      statusEl.textContent = "Microphone access already granted! You can close this tab.";
      statusEl.className = "status status-granted";
      grantBtn.textContent = "Close Tab";
      grantBtn.onclick = () => window.close();
    }
  })
  .catch(() => {
    // permissions.query not supported — rely on button click
  });
