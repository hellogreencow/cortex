# CORTEX: The Runtime-Source Bridge

**Cortex** is not a chatbot. It is a bi-directional intelligence layer that connects your browser's runtime state (entropy) to your local source code (truth).

## Architecture

$$
\text{Browser Runtime} \xrightarrow{\text{Entropy Vector}} \text{Cortex Sensor} \xrightarrow{\text{WebSockets}} \text{Cortex Synapse} \xrightarrow{\text{LLM}} \text{Source Patch}
$$

1.  **Sensor (Extension)**: Injects a Ring Buffer to capture the last 50 user interaction events ($t_{-50} \to t_0$).
2.  **Synapse (CLI)**: A Node.js daemon that bridges the air-gap between the browser sandbox and the local filesystem.
3.  **Capsule**: A structured JSON payload containing the Error, the DOM State, and the Action History.

## Installation

### 1. Ignite the Synapse (CLI)
```bash
cd cli
npm install
npm start
```
The Synapse binds to `127.0.0.1:2112` by default and prints a one-time auth code on startup.

Optional: use a `.env` file (recommended).

- Copy `cli/env.example` → `cli/.env`
- The daemon and MCP server load `.env` automatically (dotenv).

### 2. Equip the Sensor (Extension)
1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer Mode**.
3.  Click **Load Unpacked**.
4.  Select the `cortex/extension` directory.

## Usage (no DevTools): the point of CORTEX

This is the intended workflow: you reproduce the bug normally, and your coding agent fetches the capsule via MCP. No copying logs, no DevTools ritual.

1. Start the CLI (it prints an auth code).
2. Click the CORTEX extension icon:
   - Paste the auth code
   - Enable **Auto-capture**
   - (Optional) Click **Capture now** to verify the pipeline immediately
3. Reproduce the bug in the browser.
4. In Claude Code / Cursor, ask the agent to pull the latest capsule via MCP (see below).

## Usage (manual): DevTools Console API (optional)

1.  Open your project in the browser.
2.  Open DevTools Console (`Cmd+Opt+J`).
3.  **Handshake (optional)**: Authenticate using the auth code printed by the CLI.
    ```javascript
    agent.auth('PASTE_THE_CODE_FROM_TERMINAL')
    ```
4.  **Execute**: Send a Bug Capsule.
    ```javascript
    agent.capture("Capture capsule now (no LLM)")
    agent.diagnose("Explain what is happening and what to check next (LLM optional)")
    ```
    `agent.fix(...)` is currently an alias of `agent.diagnose(...)`.

## Features

*   **Time Travel**: The Agent sees what you did *before* the error occurred.
*   **Air-Gap Bridge**: WebSocket tunnel to loopback (`127.0.0.1`) only.
*   **State Capture**: DOM snippets are text-stripped and key attributes are redacted to reduce PII leakage.

## MCP (Claude Code / Cursor / any MCP-capable coding agent)

The CLI can run as an MCP server over stdio so your primary coding agent can pull the latest capsule on-demand.

This is intentionally not a PR daemon. MCP is the bridge: your main coding agent uses CORTEX as a source of runtime evidence (capsules/diagnoses).

Start it:

```bash
cd cli
npm run mcp
```

Exposed tools:

- `cortex_list_capsules`
- `cortex_get_last_capsule`
- `cortex_get_capsule`
- `cortex_get_last_diagnosis`
- `cortex_get_diagnosis`

Intended workflow:

1. Let auto-capture collect a capsule, or trigger one via `agent.capture(...)` / `agent.diagnose(...)`.
2. In your coding agent, call `cortex_get_last_capsule` (and optionally `cortex_get_last_diagnosis`) to ingest the evidence.

### Setup: Claude Code

Claude Code supports local stdio MCP servers. From the official docs, the syntax is:

```bash
claude mcp add --transport stdio <name> <command> [args...]
```

For CORTEX, a typical setup is:

```bash
claude mcp add --transport stdio cortex -- node /absolute/path/to/cortex/cli/mcp-server.mjs
```

If you want Claude Code to read capsules from a specific directory, pass `CORTEX_DATA_DIR`:

```bash
claude mcp add --transport stdio cortex --env CORTEX_DATA_DIR=/absolute/path/to/.cortex -- node /absolute/path/to/cortex/cli/mcp-server.mjs
```

Docs: `https://code.claude.com/docs/en/mcp`

### Setup: Cursor

Cursor uses `mcp.json` configuration. Put this in `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "cortex": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/cortex/cli/mcp-server.mjs"],
      "env": {
        "CORTEX_DATA_DIR": "/absolute/path/to/.cortex"
      }
    }
  }
}
```

Docs: `https://cursor.com/docs/context/mcp`

## Configuration (optional)

Set env vars before starting the CLI:

- `CORTEX_PORT`: override port (default `2112`)
- `CORTEX_HOST`: override host (default `127.0.0.1`)
- `CORTEX_AUTH_CODE`: provide a fixed auth code (otherwise random)
- `CORTEX_MAX_PAYLOAD_BYTES`: max inbound message size (default `1048576`)
- `CORTEX_DATA_DIR`: where to store captured capsules/diagnoses (default: `./.cortex`)

LLM (OpenRouter):

- `OPENROUTER_API_KEY`: required to enable daemon-side diagnosis (optional; capsules still save without it)
- `OPENROUTER_MODEL`: optional (default: `anthropic/claude-3.5-sonnet`)
- `OPENROUTER_BASE_URL`: optional (default: `https://openrouter.ai/api/v1`)
- `OPENROUTER_TIMEOUT_MS`: optional (default: `60000`)
- `OPENROUTER_APP_URL`: optional (default: `http://localhost`)
- `OPENROUTER_APP_NAME`: optional (default: `CORTEX`)

