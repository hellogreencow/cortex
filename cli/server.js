const WebSocket = require('ws');
const chalk = require('chalk');
const crypto = require('crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

// NOTE: do not default to process.env.PORT; many environments set it implicitly and that breaks
// the extension which assumes 2112 unless explicitly configured.
const PORT = Number(process.env.CORTEX_PORT || 2112);
const HOST = process.env.CORTEX_HOST || '127.0.0.1';
const MAX_PAYLOAD_BYTES = Number(process.env.CORTEX_MAX_PAYLOAD_BYTES || 1024 * 1024);
const AUTH_CODE = process.env.CORTEX_AUTH_CODE || crypto.randomBytes(8).toString('hex');
const DATA_DIR = process.env.CORTEX_DATA_DIR || path.join(process.cwd(), '.cortex');
const CAPSULES_DIR = path.join(DATA_DIR, 'capsules');
const DIAGNOSES_DIR = path.join(DATA_DIR, 'diagnoses');

const wss = new WebSocket.Server({
    port: PORT,
    host: HOST,
    maxPayload: MAX_PAYLOAD_BYTES,
});

fs.mkdir(CAPSULES_DIR, { recursive: true }).catch(() => {});
fs.mkdir(DIAGNOSES_DIR, { recursive: true }).catch(() => {});

console.clear();
console.log(chalk.bold.green(`\nCORTEX: RUNTIME INTELLIGENCE BRIDGE`));
console.log(chalk.gray(`----------------------------------------`));
console.log(chalk.cyan(`Synapse active on ${HOST}:${PORT}`));
console.log(chalk.yellow(`Auth code: ${chalk.bold(AUTH_CODE)}`));
console.log(chalk.gray(`\nTo pair, open Console and run:`));
console.log(chalk.white(`   agent.auth('${AUTH_CODE}')`));
console.log(chalk.gray(`----------------------------------------`));

function makeId() {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = crypto.randomBytes(4).toString('hex');
    return `${ts}-${rand}`;
}

function safeString(value, maxLen) {
    if (typeof value !== 'string') return '';
    return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function redactSecrets(text) {
    if (!text) return '';
    let s = String(text);
    // Emails
    s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
    // JWT-ish
    s = s.replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, '[REDACTED_JWT]');
    // Common API key prefixes
    s = s.replace(/\b(sk|rk|pk)_[a-zA-Z0-9]{16,}\b/g, '[REDACTED_KEY]');
    // Bearer tokens
    s = s.replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/g, 'Bearer [REDACTED]');
    return s;
}

function normalizeCapsule(data, id) {
    const ctx = data?.context && typeof data.context === 'object' ? data.context : {};
    const signals = ctx?.signals && typeof ctx.signals === 'object' ? ctx.signals : {};

    const actions = Array.isArray(ctx.actions) ? ctx.actions.slice(-50) : [];
    const failedFetches = Array.isArray(signals.failedFetches) ? signals.failedFetches.slice(-10) : [];

    return {
        id,
        receivedAt: new Date().toISOString(),
        instructions: safeString(data.instructions, 1000),
        context: {
            url: safeString(ctx.url, 2000),
            title: safeString(ctx.title, 300),
            selection: safeString(ctx.selection, 256),
            actions: actions.map((a) => ({
                type: safeString(a?.type, 40),
                target: safeString(a?.target, 200),
                timestamp: Number(a?.timestamp || 0),
            })),
            dom: safeString(ctx.dom, 5000),
            signals: {
                lastError: signals.lastError || null,
                lastUnhandledRejection: signals.lastUnhandledRejection || null,
                lastConsoleError: signals.lastConsoleError || null,
                failedFetches,
            },
        },
    };
}

async function diagnoseWithOpenRouter(capsule) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return { ok: false, error: 'OPENROUTER_API_KEY is not set in the CLI environment.' };
    }

    const model = process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-sonnet';
    const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
    const appUrl = process.env.OPENROUTER_APP_URL || 'http://localhost';
    const appName = process.env.OPENROUTER_APP_NAME || 'CORTEX';

    const prompt = redactSecrets(
        [
            'You are an expert web debugging assistant.',
            'Given a bug capsule captured from a real browser runtime, explain what is most likely happening and what to check next.',
            '',
            'Rules:',
            '- Be concise and evidence-driven.',
            '- Prefer ranked hypotheses with supporting evidence.',
            '- Do not request secrets (tokens, cookies, full payloads).',
            '- Suggest concrete next diagnostic steps in DevTools.',
            '',
            'Bug capsule (JSON):',
            JSON.stringify(capsule, null, 2),
        ].join('\n')
    );

    const controller = new AbortController();
    const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS || 60_000);
    const t = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': appUrl,
                'X-Title': appName,
            },
            body: JSON.stringify({
                model,
                temperature: 0.2,
                max_tokens: 700,
                messages: [
                    { role: 'user', content: prompt },
                ],
            }),
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            return { ok: false, error: `OpenRouter error ${res.status}: ${text.slice(0, 500)}` };
        }

        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
            return { ok: false, error: 'OpenRouter returned an empty response.' };
        }
        return { ok: true, text: content.trim(), model };
    } catch (e) {
        const msg = e && typeof e === 'object' && 'message' in e ? String(e.message) : String(e);
        return { ok: false, error: `OpenRouter request failed: ${msg}` };
    } finally {
        clearTimeout(t);
    }
}

wss.on('connection', (ws) => {
    console.log(chalk.blue(`\nSensor connected`));
    let authenticated = false;

    ws.on('message', (message) => {
        try {
            const raw = typeof message === 'string' ? message : Buffer.from(message).toString('utf8');
            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
            
            if (data.type === 'auth') {
                if (typeof data.code === 'string' && data.code === AUTH_CODE) {
                    authenticated = true;
                    console.log(chalk.green(`Authentication successful`));
                    ws.send(JSON.stringify({ type: 'status', msg: 'CORTEX_CONNECTED' }));
                } else {
                    console.log(chalk.red(`Authentication failed: invalid code`));
                    ws.send(JSON.stringify({ type: 'error', msg: 'INVALID_AUTH' }));
                }
                return;
            }

            if (!authenticated) {
                console.log(chalk.red(`Unauthorized payload received`));
                return;
            }

            if (data.type === 'diagnose_request' || data.type === 'fix_request') {
                const id = makeId();
                const capsule = normalizeCapsule(data, id);

                const url = capsule?.context?.url;
                const eventsLen = Array.isArray(capsule?.context?.actions) ? capsule.context.actions.length : 0;
                const instruction = typeof capsule.instructions === 'string' ? capsule.instructions : '';

                console.log(chalk.cyan(`\nIncoming bug capsule`));
                console.log(chalk.gray(`ID: ${id}`));
                if (typeof url === 'string' && url) console.log(chalk.gray(`URL: ${url}`));
                console.log(chalk.gray(`Events recorded: ${eventsLen}`));
                if (instruction) console.log(chalk.white(`Instruction: ${instruction.slice(0, 200)}`));

                const capsulePath = path.join(CAPSULES_DIR, `${id}.json`);
                fs.writeFile(capsulePath, JSON.stringify(capsule, null, 2), 'utf8')
                    .then(() => {
                        ws.send(JSON.stringify({ type: 'capsule_saved', id }));
                    })
                    .catch(() => {
                        ws.send(JSON.stringify({ type: 'error', msg: 'CAPSULE_SAVE_FAILED', id }));
                    });

                (async () => {
                    console.log(chalk.yellow(`Diagnosing...`));
                    const result = await diagnoseWithOpenRouter(capsule);
                    if (!result.ok) {
                        console.log(chalk.red(`Diagnosis failed: ${result.error}`));
                        ws.send(JSON.stringify({ type: 'diagnosis', id, ok: false, msg: result.error }));
                        return;
                    }

                    const text = result.text;
                    const diagPath = path.join(DIAGNOSES_DIR, `${id}.txt`);
                    fs.writeFile(diagPath, text, 'utf8').catch(() => {});

                    console.log(chalk.green(`Diagnosis ready (model: ${result.model})`));
                    ws.send(JSON.stringify({ type: 'diagnosis', id, ok: true, msg: text, model: result.model }));
                })();
            }

        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(chalk.gray(`\nSensor disconnected`));
    });
});

