class CortexAgent {
    constructor() {
        this.buffer = [];
        this.authCode = null;
        this.initBuffer();
        console.log("%c CORTEX AGENT ACTIVE ", "background: #000; color: #0f0; font-weight: bold; padding: 4px; border-radius: 4px;");
    }

    initBuffer() {
        // Circular buffer for the last 50 interactions (The Time Machine)
        const events = ['click', 'keydown', 'input', 'scroll'];
        events.forEach(evt => {
            window.addEventListener(evt, (e) => {
                const targetEl = e && e.target && e.target.tagName ? e.target : null;
                const tag = targetEl?.tagName || 'UNKNOWN';
                const id = targetEl?.id ? `#${targetEl.id}` : '';
                const className =
                    targetEl && typeof targetEl.className === 'string'
                        ? targetEl.className.trim()
                        : '';
                const cls = className ? `.${className.split(/\s+/).join('.')}` : '';

                const entry = {
                    type: evt,
                    target: `${tag}${id}${cls}`,
                    timestamp: Date.now()
                };
                this.buffer.push(entry);
                if (this.buffer.length > 50) this.buffer.shift();
            }, { passive: true, capture: true });
        });
    }

    auth(code) {
        this.authCode = code;
        this.send({ type: 'auth', code });
        return "Attempting handshake with Cortex Core...";
    }

    fix(instruction = "Fix this error") {
        if (!this.authCode) {
            console.warn("%c AUTH REQUIRED ", "color: red; font-weight: bold");
            return "Please run agent.auth('CODE') first.";
        }

        const capsule = {
            type: 'fix_request',
            instructions: instruction,
            context: {
                url: window.location.href,
                title: document.title,
                dom: this.getSnippet(),
                actions: this.buffer,
                selection: (window.getSelection?.().toString?.() || '').slice(0, 256)
            }
        };
        
        this.send(capsule);
        return "Bug Capsule transmitted to Cortex. Analyzing...";
    }

    getSnippet() {
        // Get relevant DOM, minimizing PII by stripping textContent.
        try {
            const root = document.activeElement || document.body || document.documentElement;
            const clone = root.cloneNode(true);

            // Strip text nodes.
            const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);
            for (const n of textNodes) n.nodeValue = '';

            // Redact high-risk attributes.
            const redactNames = new Set(['value', 'href', 'src', 'action']);
            const els = clone.querySelectorAll ? clone.querySelectorAll('*') : [];
            for (const el of els) {
                if (!el.attributes) continue;
                for (const attr of Array.from(el.attributes)) {
                    const name = String(attr.name || '').toLowerCase();
                    if (name.startsWith('data-') || redactNames.has(name)) {
                        el.setAttribute(attr.name, '[REDACTED]');
                    }
                }
            }

            const html = clone.outerHTML || '';
            return html.slice(0, 5000);
        } catch {
            return '';
        }
    }

    send(data) {
        window.dispatchEvent(new CustomEvent("cortex-uplink", { detail: data }));
    }
}

// Attach to window
window.agent = new CortexAgent();

// Listen for responses from the content script.
window.addEventListener("message", (event) => {
    if (!event || !event.data || event.data.type !== "cortex-downlink") return;
    const msg = event.data.detail;
    if (msg.type === 'status') {
        console.log(`%c CORTEX: ${msg.msg} `, "color: #0f0");
    } else if (msg.type === 'response') {
        console.log(`%c CORTEX RESPONSE: `, "color: #0ff", msg.msg);
    } else if (msg.type === 'error') {
        console.log(`%c CORTEX ERROR: `, "color: #f00", msg.msg);
    }
});

