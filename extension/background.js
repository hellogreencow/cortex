let socket = null;
let isConnected = false;

function connect() {
    console.log('Connecting to Cortex Synapse...');
    socket = new WebSocket('ws://localhost:2112');

    socket.onopen = () => {
        console.log('Cortex Synapse Connected');
        isConnected = true;
    };

    socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        // Broadcast to all tabs
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                // MV3 chrome.* APIs are callback-based; avoid assuming Promises.
                chrome.tabs.sendMessage(tab.id, msg, () => {
                    // Ignore errors for tabs without the content script.
                    void chrome.runtime.lastError;
                });
            });
        });
    };

    socket.onclose = () => {
        console.log('Disconnected. Retrying in 5s...');
        isConnected = false;
        setTimeout(connect, 5000);
    };

    socket.onerror = (err) => {
        console.error('WebSocket Error:', err);
    };
}

connect();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isConnected && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
    } else {
        console.warn('Cortex Disconnected - Message Queued/Dropped');
    }
});

