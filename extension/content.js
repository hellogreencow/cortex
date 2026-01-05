// Ask the background script to inject the agent into the MAIN world.
chrome.runtime.sendMessage({ type: 'ensure_injected' }, () => {
    void chrome.runtime.lastError;
});

// Request current config from background and forward to the page.
chrome.runtime.sendMessage({ type: 'get_config' }, (resp) => {
    const err = chrome.runtime.lastError;
    if (err) return;
    const autoCapture = Boolean(resp && resp.cortexAutoCapture);
    const armedOrigins = resp && Array.isArray(resp.cortexArmedOrigins) ? resp.cortexArmedOrigins : [];
    window.postMessage({ type: 'cortex-config', autoCapture, armedOrigins }, "*");
});

// Uplink: Page -> Extension -> Background
window.addEventListener("cortex-uplink", (event) => {
    const detail = event && event.detail ? event.detail : null;

    // Special case: allow injected agent to request config reliably.
    if (detail && detail.type === 'get_config') {
        chrome.runtime.sendMessage({ type: 'get_config' }, (resp) => {
            const err = chrome.runtime.lastError;
            if (err) return;
            const autoCapture = Boolean(resp && resp.cortexAutoCapture);
            window.postMessage({ type: 'cortex-config', autoCapture }, "*");
        });
        return;
    }

    chrome.runtime.sendMessage(detail);
});

// Downlink: Background -> Extension -> Page
chrome.runtime.onMessage.addListener((message) => {
    // Forward config updates explicitly for the injected agent.
    if (message && message.type === 'cortex-config') {
        const autoCapture = Boolean(message.autoCapture);
        const armedOrigins = Array.isArray(message.armedOrigins) ? message.armedOrigins : [];
        window.postMessage({ type: 'cortex-config', autoCapture, armedOrigins }, "*");
        return;
    }

    window.postMessage({ type: "cortex-downlink", detail: message }, "*");
});

