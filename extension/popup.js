async function getConfig() {
  return await chrome.storage.local.get({
    cortexAuthCode: "",
    cortexAutoCapture: false,
    cortexArmedOrigins: [],
  });
}

async function setConfig({ cortexAuthCode, cortexAutoCapture, cortexArmedOrigins }) {
  await chrome.storage.local.set({ cortexAuthCode, cortexAutoCapture, cortexArmedOrigins });
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
  const armSite = document.getElementById("armSite");
  const currentSite = document.getElementById("currentSite");
  const saveBtn = document.getElementById("saveBtn");
  const captureBtn = document.getElementById("captureBtn");
  const diagnoseBtn = document.getElementById("diagnoseBtn");

  async function getActiveOrigin() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== "number") throw new Error("No active tab.");
    const url = tab.url || "";
    const origin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return "";
      }
    })();
    return { tabId: tab.id, origin };
  }

  const cfg = await getConfig();
  authInput.value = cfg.cortexAuthCode || "";
  autoCapture.checked = Boolean(cfg.cortexAutoCapture);
  const armedOrigins = Array.isArray(cfg.cortexArmedOrigins) ? cfg.cortexArmedOrigins : [];

  let active = { tabId: null, origin: "" };
  try {
    active = await getActiveOrigin();
  } catch {
    // ignore
  }

  if (currentSite) currentSite.textContent = active.origin || "(unknown)";
  if (armSite) armSite.checked = Boolean(active.origin && armedOrigins.includes(active.origin));

  setStatus("Saved settings load completed.");

  async function withActiveTab(fn) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || typeof tab.id !== "number") throw new Error("No active tab.");
    return await fn(tab.id);
  }

  async function runInTab(tabId, mode, note) {
    // Ensure the agent exists in the page MAIN world (not extension isolated world).
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: ["injected.js"],
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
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
    const prev = await getConfig();
    const ao = Array.isArray(prev.cortexArmedOrigins) ? prev.cortexArmedOrigins : [];
    await setConfig({ cortexAuthCode: newCode, cortexAutoCapture: newAuto, cortexArmedOrigins: ao });
    setStatus("Saved. Reload the target tab if you want config to apply immediately.");
  });

  armSite.addEventListener("change", async () => {
    try {
      const prev = await getConfig();
      const ao = new Set(Array.isArray(prev.cortexArmedOrigins) ? prev.cortexArmedOrigins : []);
      const { origin } = await getActiveOrigin();
      if (!origin) throw new Error("Could not determine current origin.");

      if (armSite.checked) {
        ao.add(origin);
      } else {
        ao.delete(origin);
      }

      // If you're explicitly arming a site, auto-enable auto-capture.
      const newAuto = armSite.checked ? true : Boolean(prev.cortexAutoCapture);
      autoCapture.checked = newAuto;

      await setConfig({
        cortexAuthCode: String(prev.cortexAuthCode || "").trim(),
        cortexAutoCapture: newAuto,
        cortexArmedOrigins: Array.from(ao),
      });
      setStatus(armSite.checked ? "Site armed for capture." : "Site disarmed.");
    } catch (e) {
      setStatus(`Failed to update site arming: ${e instanceof Error ? e.message : String(e)}`);
    }
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


