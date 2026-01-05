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
  const autoCapture = document.getElementById("autoCapture");
  const saveBtn = document.getElementById("saveBtn");

  const cfg = await getConfig();
  authInput.value = cfg.cortexAuthCode || "";
  autoCapture.checked = Boolean(cfg.cortexAutoCapture);
  setStatus("Saved settings load completed.");

  saveBtn.addEventListener("click", async () => {
    const newCode = String(authInput.value || "").trim();
    const newAuto = Boolean(autoCapture.checked);
    await setConfig({ cortexAuthCode: newCode, cortexAutoCapture: newAuto });
    setStatus("Saved. Reload the target tab if you want config to apply immediately.");
  });
});


