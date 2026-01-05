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

### 2. Equip the Sensor (Extension)
1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer Mode**.
3.  Click **Load Unpacked**.
4.  Select the `cortex/extension` directory.

## Usage: The "Beast" Protocol

1.  Open your project in the browser.
2.  Open DevTools Console (`Cmd+Opt+J`).
3.  **Handshake**: Authenticate with the Synapse using the auth code printed by the CLI.
    ```javascript
    agent.auth('PASTE_THE_CODE_FROM_TERMINAL')
    ```
4.  **Execute**: Send a Bug Capsule to the Core.
    ```javascript
    agent.diagnose("The login button is not submitting the form")
    ```
    `agent.fix(...)` is currently an alias of `agent.diagnose(...)`.

## Features

*   **Time Travel**: The Agent sees what you did *before* the error occurred.
*   **Air-Gap Bridge**: WebSocket tunnel to loopback (`127.0.0.1`) only.
*   **State Capture**: DOM snippets are text-stripped and key attributes are redacted to reduce PII leakage.

## MCP (for Claude Code / Cursor / PR agents)

The CLI can also run as an MCP server over stdio so your primary coding agent can pull the latest capsule on-demand.

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

1. Capture a capsule in the browser via `agent.diagnose(...)`.
2. In Claude Code / Cursor, have the agent call `cortex_get_last_capsule` and then generate a patch/PR in your repo using its native git tooling.

## Configuration (optional)

Set env vars before starting the CLI:

- `CORTEX_PORT`: override port (default `2112`)
- `CORTEX_HOST`: override host (default `127.0.0.1`)
- `CORTEX_AUTH_CODE`: provide a fixed auth code (otherwise random)
- `CORTEX_MAX_PAYLOAD_BYTES`: max inbound message size (default `1048576`)
- `CORTEX_DATA_DIR`: where to store captured capsules/diagnoses (default: `./.cortex`)

LLM (OpenRouter):

- `OPENROUTER_API_KEY`: required to enable diagnosis
- `OPENROUTER_MODEL`: optional (default: `anthropic/claude-3.5-sonnet`)
- `OPENROUTER_BASE_URL`: optional (default: `https://openrouter.ai/api/v1`)
- `OPENROUTER_TIMEOUT_MS`: optional (default: `60000`)
- `OPENROUTER_APP_URL`: optional (default: `http://localhost`)
- `OPENROUTER_APP_NAME`: optional (default: `CORTEX`)

