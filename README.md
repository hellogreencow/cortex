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
    agent.fix("The login button is not submitting the form")
    ```

## Features

*   **Time Travel**: The Agent sees what you did *before* the error occurred.
*   **Air-Gap Bridge**: WebSocket tunnel to loopback (`127.0.0.1`) only.
*   **State Capture**: DOM snippets are text-stripped and key attributes are redacted to reduce PII leakage.

## Configuration (optional)

Set env vars before starting the CLI:

- `CORTEX_PORT`: override port (default `2112`)
- `CORTEX_HOST`: override host (default `127.0.0.1`)
- `CORTEX_AUTH_CODE`: provide a fixed auth code (otherwise random)
- `CORTEX_MAX_PAYLOAD_BYTES`: max inbound message size (default `1048576`)

