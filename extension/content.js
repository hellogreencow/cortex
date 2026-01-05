// Inject the Beast Agent into the page context
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.onload = function() {
    this.remove();
};
(document.head || document.documentElement).appendChild(script);

// Uplink: Page -> Extension -> Background
window.addEventListener("cortex-uplink", (event) => {
    chrome.runtime.sendMessage(event.detail);
});

// Downlink: Background -> Extension -> Page
chrome.runtime.onMessage.addListener((message) => {
    window.postMessage({ type: "cortex-downlink", detail: message }, "*");
});

