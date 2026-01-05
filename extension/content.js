// Inject the Beast Agent into the page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Request current config from background and forward to the page.
chrome.runtime.sendMessage({ type: 'get_config' }, (resp) => {
    const err = chrome.runtime.lastError;
    if (err) return;
    const autoCapture = Boolean(resp && resp.cortexAutoCapture);
    window.postMessage({ type: 'cortex-config', autoCapture }, "*");
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
        window.postMessage({ type: 'cortex-config', autoCapture: Boolean(message.autoCapture) }, "*");
        return;
    }

    window.postMessage({ type: "cortex-downlink", detail: message }, "*");
});

