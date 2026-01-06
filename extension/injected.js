(() => {
    // Idempotent injection: avoid redeclaring globals when we inject multiple times.
    if (window.__CORTEX_AGENT_LOADED && window.agent) {
        try {
            window.agent.send?.({ type: 'get_config' });
        } catch {
            // ignore
        }
        return;
    }
    window.__CORTEX_AGENT_LOADED = true;

class CortexAgent {
    constructor() {
        this.buffer = [];
        this.authCode = null;
        this.lastError = null;
        this.lastUnhandledRejection = null;
        this.lastConsoleError = null;
        this.failedFetches = [];
        this.autoCaptureWanted = false;
        this.armedOrigins = [];
        this.armed = false;
        this._lastAutoCaptureAt = 0;
        this._autoCaptureMinIntervalMs = 5000;

        // Only instrument once per page.
        if (!window.__cortexInstrumented) {
            window.__cortexInstrumented = true;
            this.initErrorCapture();
            this.initNetworkCapture();
        } else {
            // If already instrumented (e.g., extension reloaded), reuse any existing state.
            this.lastError = window.__cortexLastError || null;
            this.lastUnhandledRejection = window.__cortexLastUnhandledRejection || null;
            this.lastConsoleError = window.__cortexLastConsoleError || null;
            this.failedFetches = Array.isArray(window.__cortexFailedFetches) ? window.__cortexFailedFetches : [];
        }

        this.initBuffer();
        // Ask the extension for current config (auto-capture), so we do not require DevTools.
        try {
            this.send({ type: 'get_config' });
        } catch {
            // ignore
        }
        console.log("%c CORTEX AGENT ACTIVE ", "background: #000; color: #0f0; font-weight: bold; padding: 4px; border-radius: 4px;");
    }

    setAutoCapture(enabled) {
        this.autoCaptureWanted = Boolean(enabled);
        return `Auto-capture ${this.autoCaptureWanted ? 'enabled' : 'disabled'}.`;
    }

    setArmedOrigins(origins) {
        this.armedOrigins = Array.isArray(origins) ? origins : [];
        try {
            const origin = window.location && window.location.origin ? window.location.origin : '';
            this.armed = Boolean(origin && this.armedOrigins.includes(origin));
        } catch {
            this.armed = false;
        }
        return this.armed ? 'Site armed.' : 'Site not armed.';
    }

    _isAutoCaptureActive() {
        return Boolean(this.autoCaptureWanted && this.armed);
    }

    _maybeAutoCapture(trigger) {
        if (!this._isAutoCaptureActive()) return;
        const now = Date.now();
        if (now - this._lastAutoCaptureAt < this._autoCaptureMinIntervalMs) return;
        this._lastAutoCaptureAt = now;
        this.capture(`Auto-capture triggered by ${String(trigger || 'signal')}`);
    }

    initErrorCapture() {
        const record = (kind, payload) => {
            const entry = { kind, timestamp: Date.now(), ...payload };
            if (kind === 'error') window.__cortexLastError = entry;
            if (kind === 'unhandledrejection') window.__cortexLastUnhandledRejection = entry;
            if (kind === 'console_error') window.__cortexLastConsoleError = entry;

            // Auto-capture on new signals (if enabled).
            try {
                window.agent?._maybeAutoCapture?.(kind);
            } catch {
                // ignore
            }
        };

        window.addEventListener('error', (event) => {
            record('error', {
                message: String(event?.message || ''),
                filename: String(event?.filename || ''),
                lineno: Number(event?.lineno || 0),
                colno: Number(event?.colno || 0),
                stack: event?.error?.stack ? String(event.error.stack) : ''
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event?.reason;
            record('unhandledrejection', {
                message: reason instanceof Error ? reason.message : String(reason || ''),
                stack: reason instanceof Error && reason.stack ? String(reason.stack) : ''
            });
        });

        if (!console.__cortexWrapped) {
            console.__cortexWrapped = true;
            const origError = console.error.bind(console);
            console.error = (...args) => {
                try {
                    record('console_error', {
                        argsPreview: args.map((a) => {
                            if (typeof a === 'string') return a.slice(0, 200);
                            if (a instanceof Error) return `${a.name}: ${a.message}`.slice(0, 200);
                            try { return JSON.stringify(a).slice(0, 200); } catch { return String(a).slice(0, 200); }
                        })
                    });
                } catch {
                    // ignore
                }
                origError(...args);
            };
        }
    }

    initNetworkCapture() {
        const sanitizeUrl = (input) => {
            try {
                const u = new URL(String(input), window.location.href);
                const keys = Array.from(u.searchParams.keys()).sort();
                const q = keys.length ? `?${keys.join('&')}` : '';
                return `${u.origin}${u.pathname}${q}`;
            } catch {
                return String(input || '').slice(0, 500);
            }
        };

        const recordFailedFetch = (entry) => {
            const buf = Array.isArray(window.__cortexFailedFetches) ? window.__cortexFailedFetches : [];
            buf.push(entry);
            while (buf.length > 10) buf.shift();
            window.__cortexFailedFetches = buf;

            // Auto-capture on failed network (if enabled).
            try {
                window.agent?._maybeAutoCapture?.('fetch');
            } catch {
                // ignore
            }
        };

        if (!window.__cortexFetchWrapped && typeof window.fetch === 'function') {
            window.__cortexFetchWrapped = true;
            const origFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
                const start = Date.now();
                let method = 'GET';
                try {
                    if (init?.method) method = String(init.method).toUpperCase();
                    else if (input && typeof input === 'object' && 'method' in input && input.method) method = String(input.method).toUpperCase();
                } catch {
                    // ignore
                }

                try {
                    const res = await origFetch(input, init);
                    if (!res.ok) {
                        recordFailedFetch({
                            kind: 'fetch',
                            timestamp: Date.now(),
                            url: sanitizeUrl(input && typeof input === 'object' && 'url' in input ? input.url : input),
                            method,
                            status: res.status,
                            statusText: String(res.statusText || ''),
                            durationMs: Date.now() - start
                        });
                    }
                    return res;
                } catch (err) {
                    recordFailedFetch({
                        kind: 'fetch',
                        timestamp: Date.now(),
                        url: sanitizeUrl(input && typeof input === 'object' && 'url' in input ? input.url : input),
                        method,
                        status: null,
                        statusText: '',
                        durationMs: Date.now() - start,
                        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err || '')
                    });
                    throw err;
                }
            };
        }
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

    capture(instruction = "Capture a bug capsule") {
        const lastError = window.__cortexLastError || null;
        const lastUnhandledRejection = window.__cortexLastUnhandledRejection || null;
        const lastConsoleError = window.__cortexLastConsoleError || null;
        const failedFetches = Array.isArray(window.__cortexFailedFetches) ? window.__cortexFailedFetches : [];

        const capsule = {
            type: 'capture_request',
            instructions: instruction,
            context: {
                url: window.location.href,
                title: document.title,
                dom: this.getSnippet(),
                actions: this.buffer,
                selection: (window.getSelection?.().toString?.() || '').slice(0, 256),
                signals: {
                    lastError,
                    lastUnhandledRejection,
                    lastConsoleError,
                    failedFetches
                }
            }
        };
        
        this.send(capsule);
        return "Bug Capsule transmitted to Cortex (capture-only).";
    }

    diagnose(instruction = "Explain what is happening and what to check next") {
        // Same capsule as capture(), but request a diagnosis from the daemon (LLM optional).
        const lastError = window.__cortexLastError || null;
        const lastUnhandledRejection = window.__cortexLastUnhandledRejection || null;
        const lastConsoleError = window.__cortexLastConsoleError || null;
        const failedFetches = Array.isArray(window.__cortexFailedFetches) ? window.__cortexFailedFetches : [];

        const capsule = {
            type: 'diagnose_request',
            instructions: instruction,
            context: {
                url: window.location.href,
                title: document.title,
                dom: this.getSnippet(),
                actions: this.buffer,
                selection: (window.getSelection?.().toString?.() || '').slice(0, 256),
                signals: {
                    lastError,
                    lastUnhandledRejection,
                    lastConsoleError,
                    failedFetches
                }
            }
        };

        this.send(capsule);
        return "Bug Capsule transmitted to Cortex. Diagnosing...";
    }

    fix(instruction = "Fix this error") {
        return this.diagnose(instruction);
    }

    testSite() {
        // Lightweight, safe-ish UI smoke test that stays within the current page session.
        // It clicks a limited number of visible, non-destructive interactive elements and captures if new errors appear.
        const run = async () => {
            const startUrl = window.location.href;
            const startTs = Date.now();
            const maxClicks = 15;
            const clickDelayMs = 250;

            const getLastErrTs = () => (window.__cortexLastError && window.__cortexLastError.timestamp) ? window.__cortexLastError.timestamp : 0;
            const getLastConsoleErrTs = () => (window.__cortexLastConsoleError && window.__cortexLastConsoleError.timestamp) ? window.__cortexLastConsoleError.timestamp : 0;
            const getLastUnhandledTs = () => (window.__cortexLastUnhandledRejection && window.__cortexLastUnhandledRejection.timestamp) ? window.__cortexLastUnhandledRejection.timestamp : 0;

            const beforeErr = getLastErrTs();
            const beforeCon = getLastConsoleErrTs();
            const beforeUnh = getLastUnhandledTs();

            const dangerousRe = /(delete|remove|destroy|logout|log out|sign out|unsubscribe|checkout|purchase|pay|billing|cancel subscription)/i;

            const isVisible = (el) => {
                try {
                    const r = el.getBoundingClientRect();
                    if (!r || r.width < 4 || r.height < 4) return false;
                    const style = window.getComputedStyle(el);
                    if (!style || style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
                    return true;
                } catch {
                    return false;
                }
            };

            const labelFor = (el) => {
                const txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
                const aria = (el.getAttribute && el.getAttribute('aria-label')) ? el.getAttribute('aria-label') : '';
                const id = el.id ? `#${el.id}` : '';
                return (txt || aria || el.tagName || 'UNKNOWN') + id;
            };

            const candidates = Array.from(document.querySelectorAll(
                'button, [role=\"button\"], input[type=\"button\"], input[type=\"submit\"], [onclick]'
            ))
                .filter((el) => el && isVisible(el))
                .filter((el) => {
                    const txt = (el.innerText || el.textContent || '').trim();
                    const aria = (el.getAttribute && el.getAttribute('aria-label')) ? el.getAttribute('aria-label') : '';
                    return !(dangerousRe.test(txt) || dangerousRe.test(aria));
                })
                .slice(0, 80);

            let clicks = 0;
            let issues = 0;

            for (const el of candidates) {
                if (clicks >= maxClicks) break;
                clicks += 1;

                try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}

                const stepBeforeErr = getLastErrTs();
                const stepBeforeCon = getLastConsoleErrTs();
                const stepBeforeUnh = getLastUnhandledTs();

                try {
                    el.click();
                } catch {
                    // ignore click failures
                }

                await new Promise((r) => setTimeout(r, clickDelayMs));

                // Close obvious overlays/modals.
                try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch {}

                const stepAfterErr = getLastErrTs();
                const stepAfterCon = getLastConsoleErrTs();
                const stepAfterUnh = getLastUnhandledTs();

                if (stepAfterErr > stepBeforeErr || stepAfterCon > stepBeforeCon || stepAfterUnh > stepBeforeUnh) {
                    issues += 1;
                    // Capture immediately with context of what we clicked.
                    const label = labelFor(el);
                    this.capture(`Auto-test detected error after clicking: ${label}`);
                    // Throttle a bit to avoid spamming.
                    await new Promise((r) => setTimeout(r, 300));
                }
            }

            const endUrl = window.location.href;
            const endTs = Date.now();

            const anyNew =
                getLastErrTs() > beforeErr ||
                getLastConsoleErrTs() > beforeCon ||
                getLastUnhandledTs() > beforeUnh;

            // Always capture a summary capsule so the agent can fetch it via MCP.
            this.capture(
                `Auto-test complete: clicks=${clicks}, issues=${issues}, urlChanged=${String(endUrl !== startUrl)}, anyNewErrors=${String(anyNew)}`
            );

            return `Test complete. clicks=${clicks}, issues=${issues}.`;
        };

        // Fire and forget, but give immediate feedback.
        run().catch(() => {});
        return "Test started. Captures will be saved if errors are detected.";
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
    if (!event || !event.data) return;

    // Configuration updates from the extension.
    if (event.data.type === 'cortex-config') {
        const enabled = Boolean(event.data.autoCapture);
        const armedOrigins = Array.isArray(event.data.armedOrigins) ? event.data.armedOrigins : [];
        try { window.agent?.setAutoCapture?.(enabled); } catch {}
        try { window.agent?.setArmedOrigins?.(armedOrigins); } catch {}
        return;
    }

    if (event.data.type !== "cortex-downlink") return;
    const msg = event.data.detail;
    if (msg.type === 'status') {
        console.log(`%c CORTEX: ${msg.msg} `, "color: #0f0");
    } else if (msg.type === 'capsule_saved') {
        console.log(`%c CORTEX: capsule saved (${msg.id}) `, "color: #999");
    } else if (msg.type === 'response') {
        console.log(`%c CORTEX RESPONSE: `, "color: #0ff", msg.msg);
    } else if (msg.type === 'diagnosis') {
        const label = msg.ok ? 'CORTEX DIAGNOSIS' : 'CORTEX DIAGNOSIS FAILED';
        const color = msg.ok ? '#0ff' : '#f00';
        console.log(`%c ${label} (${msg.id}) `, `color: ${color}`, msg.msg);
    } else if (msg.type === 'error') {
        console.log(`%c CORTEX ERROR: `, "color: #f00", msg.msg);
    }
});

})();

