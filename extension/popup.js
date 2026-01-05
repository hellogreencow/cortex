async function getConfig() {
  return await chrome.storage.local.get({
    cortexAuthCode: "",
    cortexAutoCapture: false,
  });
}

async function setConfig({ cortexAuthCode, cortexAutoCapture }) {
  await chrome.storage.local.set({ cortexAuthCode, cortexAutoCapture });
  await chrome.runtime.sendMessage({ type: "config_updated" });
}

function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

document.addEventListener("DOMContentLoaded", async () => {
  const authInput = document.getElementById("authCode");
  const noteInput = document.getElementById("note");
  const autoCapture = document.getElementById("autoCapture");
  const saveBtn = document.getElementById("saveBtn");
  const captureBtn = document.getElementById("captureBtn");
  const diagnoseBtn = document.getElementById("diagnoseBtn");

  const cfg = await getConfig();
  authInput.value = cfg.cortexAuthCode || "";
  autoCapture.checked = Boolean(cfg.cortexAutoCapture);
  setStatus("Saved settings load completed.");

  async function withActiveTab(fn) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== "number") throw new Error("No active tab.");
    return await fn(tab.id);
  }

  async function runInTab(tabId, mode, note) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (m, n) => {
        try {
          const a = window.agent;
          if (!a) return "window.agent is not available on this page.";
          if (m === "capture") return a.capture ? a.capture(n) : "agent.capture is not available.";
          if (m === "diagnose") return a.diagnose ? a.diagnose(n) : "agent.diagnose is not available.";
          return "Unknown mode.";
        } catch (e) {
          return e && e.message ? String(e.message) : String(e);
        }
      },
      args: [mode, note],
    });
    return results && results[0] ? results[0].result : "No result.";
  }

  saveBtn.addEventListener("click", async () => {
    const newCode = String(authInput.value || "").trim();
    const newAuto = Boolean(autoCapture.checked);
    await setConfig({ cortexAuthCode: newCode, cortexAutoCapture: newAuto });
    setStatus("Saved. Reload the target tab if you want config to apply immediately.");
  });

  captureBtn.addEventListener("click", async () => {
    try {
      const note = String(noteInput.value || "").trim() || "Manual capture from popup";
      const res = await withActiveTab((tabId) => runInTab(tabId, "capture", note));
      setStatus(res);
    } catch (e) {
      setStatus(`Capture failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  diagnoseBtn.addEventListener("click", async () => {
    try {
      const note = String(noteInput.value || "").trim() || "Manual diagnose from popup";
      const res = await withActiveTab((tabId) => runInTab(tabId, "diagnose", note));
      setStatus(res);
    } catch (e) {
      setStatus(`Diagnose failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
});


