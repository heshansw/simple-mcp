// Content script — runs on Google Meet and Zoom pages
// Detects meeting info and sends to background service worker

function detectMeetingInfo() {
  const url = window.location.href;
  let title = "";

  // Google Meet: title is in the page or tab
  if (url.includes("meet.google.com")) {
    // Try to get meeting title from the page header
    const titleEl = document.querySelector("[data-meeting-title]");
    title = titleEl?.textContent?.trim() || document.title.replace(/\s*[-–—|]\s*Google Meet$/i, "").trim();
  }

  // Zoom: extract from page title
  if (url.includes("zoom.us")) {
    title = document.title.replace(/\s*[-–—|]\s*Zoom$/i, "").trim();
  }

  if (title || url) {
    chrome.runtime.sendMessage({
      type: "MEETING_DETECTED",
      title: title || "Meeting",
      url,
    });
  }
}

// Run on load and on URL changes (SPAs)
detectMeetingInfo();

const observer = new MutationObserver(() => {
  detectMeetingInfo();
});

observer.observe(document.head, {
  childList: true,
  subtree: true,
});
