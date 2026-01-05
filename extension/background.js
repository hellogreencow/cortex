let socket = null;
let isConnected = false;
let isAuthenticated = false;

let cortexAuthCode = '';
let cortexAutoCapture = false;

const knownTabIds = new Set();

async function loadConfig() {
    const cfg = await chrome.storage.local.get({
        cortexAuthCode: '',
        cortexAutoCapture: false,
    });
    cortexAuthCode = String(cfg.cortexAuthCode || '');
    cortexAutoCapture = Boolean(cfg.cortexAutoCapture);
}

function broadcastToKnownTabs(msg) {
    for (const tabId of Array.from(knownTabIds)) {
        chrome.tabs.sendMessage(tabId, msg, () => {
            const err = chrome.runtime.lastError;
            if (err && /receiving end does not exist/i.test(String(err.message || ''))) {
                knownTabIds.delete(tabId);
            }
        });
    }
}

function sendToDaemon(payload) {
    if (!isConnected || !socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
}

async function tryAuthenticate() {
    if (!cortexAuthCode) return;
    sendToDaemon({ type: 'auth', code: cortexAuthCode });
}

async function connect() {
    await loadConfig();

    socket = new WebSocket('ws://localhost:2112');

    socket.onopen = async () => {
        isConnected = true;
        isAuthenticated = false;
        await tryAuthenticate();
        broadcastToKnownTabs({ type: 'status', msg: 'CORTEX_SOCKET_CONNECTED' });
    };

    socket.onmessage = (event) => {
        let msg = null;
        try {
            msg = JSON.parse(event.data);
        } catch {
            return;
        }

        if (msg && msg.type === 'status' && msg.msg === 'CORTEX_CONNECTED') {
            isAuthenticated = true;
        }

        broadcastToKnownTabs(msg);
    };

    socket.onclose = () => {
        isConnected = false;
        isAuthenticated = false;
        broadcastToKnownTabs({ type: 'status', msg: 'CORTEX_SOCKET_DISCONNECTED' });
        setTimeout(connect, 5000);
    };

    socket.onerror = () => {
        // socket.onclose will handle retry
    };
}

connect();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
    if (tabId !== null) knownTabIds.add(tabId);

    // Config requests (content scripts / popup).
    if (message && message.type === 'get_config') {
        sendResponse({ cortexAutoCapture });
        return;
    }

    if (message && message.type === 'config_updated') {
        (async () => {
            await loadConfig();
            await tryAuthenticate();
            broadcastToKnownTabs({ type: 'cortex-config', autoCapture: cortexAutoCapture });
        })();
        return;
    }

    // Auth message from page console (optional).
    if (message && message.type === 'auth' && typeof message.code === 'string') {
        const code = String(message.code || '').trim();
        chrome.storage.local.set({ cortexAuthCode: code }).catch(() => {});
        cortexAuthCode = code;
        sendToDaemon({ type: 'auth', code });
        return;
    }

    // Everything else goes to daemon only after auth.
    if (!isAuthenticated) {
        if (tabId !== null) {
            chrome.tabs.sendMessage(tabId, { type: 'error', msg: 'NOT_AUTHENTICATED' }, () => {
                void chrome.runtime.lastError;
            });
        }
        return;
    }

    sendToDaemon(message);
});

