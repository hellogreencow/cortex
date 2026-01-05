const WebSocket = require('ws');
const chalk = require('chalk');
const crypto = require('crypto');

const PORT = Number(process.env.CORTEX_PORT || process.env.PORT || 2112);
const HOST = process.env.CORTEX_HOST || '127.0.0.1';
const MAX_PAYLOAD_BYTES = Number(process.env.CORTEX_MAX_PAYLOAD_BYTES || 1024 * 1024);
const AUTH_CODE = process.env.CORTEX_AUTH_CODE || crypto.randomBytes(8).toString('hex');

const wss = new WebSocket.Server({
    port: PORT,
    host: HOST,
    maxPayload: MAX_PAYLOAD_BYTES,
});

console.clear();
console.log(chalk.bold.green(`\nCORTEX: RUNTIME INTELLIGENCE BRIDGE`));
console.log(chalk.gray(`----------------------------------------`));
console.log(chalk.cyan(`Synapse active on ${HOST}:${PORT}`));
console.log(chalk.yellow(`Auth code: ${chalk.bold(AUTH_CODE)}`));
console.log(chalk.gray(`\nTo pair, open Console and run:`));
console.log(chalk.white(`   agent.auth('${AUTH_CODE}')`));
console.log(chalk.gray(`----------------------------------------`));

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

            if (data.type === 'fix_request') {
                const url = data?.context?.url;
                const eventsLen = Array.isArray(data?.context?.actions) ? data.context.actions.length : 0;
                const instruction = typeof data.instructions === 'string' ? data.instructions : '';

                console.log(chalk.cyan(`\nIncoming bug capsule`));
                if (typeof url === 'string') console.log(chalk.gray(`URL: ${url}`));
                console.log(chalk.gray(`Events recorded: ${eventsLen}`));
                if (instruction) console.log(chalk.white(`Instruction: ${instruction}`));
                
                // Simulation of LLM processing
                console.log(chalk.yellow(`\nThinking...`));
                setTimeout(() => {
                    console.log(chalk.green(`\nSolution generated`));
                    console.log(chalk.gray(`(This would be applied to the filesystem)`));
                    ws.send(JSON.stringify({ 
                        type: 'response', 
                        msg: 'Solution generated and ready for review.' 
                    }));
                }, 1000);
            }

        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(chalk.gray(`\nSensor disconnected`));
    });
});

