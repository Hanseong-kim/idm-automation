import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

const CREDS_DIR  = path.join(os.homedir(), 'AppData', 'Roaming', 'idm-agent');
const CREDS_FILE = path.join(CREDS_DIR, 'credentials.enc');

// AES-256-CBC key derived from machine identity — never logged
function machineKey(): Buffer {
    const identity = os.hostname() + ':' + os.userInfo().username + ':idm-agent-v1';
    return crypto.createHash('sha256').update(identity).digest();
}

function encryptData(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', machineKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    // iv:ciphertext — both hex-encoded
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(ciphertext: string): string {
    const sep = ciphertext.indexOf(':');
    if (sep === -1) throw new Error('Invalid encrypted format');
    const iv        = Buffer.from(ciphertext.slice(0, sep), 'hex');
    const encrypted = Buffer.from(ciphertext.slice(sep + 1), 'hex');
    const decipher  = crypto.createDecipheriv('aes-256-cbc', machineKey(), iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function readStore(): Record<string, string> {
    if (!fs.existsSync(CREDS_FILE)) return {};
    try {
        return JSON.parse(decryptData(fs.readFileSync(CREDS_FILE, 'utf8')));
    } catch {
        return {};
    }
}

function writeStore(store: Record<string, string>): void {
    fs.mkdirSync(CREDS_DIR, { recursive: true });
    fs.writeFileSync(CREDS_FILE, encryptData(JSON.stringify(store)), 'utf8');
}

async function promptSecret(label: string): Promise<string> {
    return new Promise<string>(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        // Mask input if stdout is a TTY
        const out = process.stdout;
        let answer = '';
        out.write(`Enter ${label}: `);
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        const onData = (ch: string) => {
            if (ch === '\r' || ch === '\n') {
                process.stdin.setRawMode?.(false);
                process.stdin.pause();
                process.stdin.removeListener('data', onData);
                out.write('\n');
                rl.close();
                resolve(answer);
            } else if (ch === '') {
                process.exit();
            } else if (ch === '' || ch === '\b') {
                answer = answer.slice(0, -1);
            } else {
                answer += ch;
            }
        };
        process.stdin.on('data', onData);
    });
}

/**
 * Retrieve a credential value using this priority:
 *  1. Environment variable (CI / .env file)
 *  2. Machine-encrypted credential store (%APPDATA%/idm-agent/credentials.enc)
 *  3. Interactive prompt (only in a TTY session), then stored for future runs
 *
 * The raw value is NEVER logged or printed.
 */
export async function getApiKey(envVarName = 'LLM_API_KEY'): Promise<string | undefined> {
    // 1 — environment variable (highest priority; supports .env via dotenv/config)
    const fromEnv = process.env[envVarName];
    if (fromEnv) return fromEnv;

    // 2 — encrypted credential store
    const store = readStore();
    if (store[envVarName]) {
        return store[envVarName];
    }

    // 3 — interactive prompt (TTY only)
    if (process.stdin.isTTY) {
        console.log(`\n[Security] ${envVarName} not found in environment or credential store.`);
        const value = await promptSecret(envVarName);
        if (value) {
            const updated = readStore();
            updated[envVarName] = value;
            writeStore(updated);
            console.log(`[Security] Credential stored in ${CREDS_FILE}`);
            // Set for the current process so nlParser can read it immediately
            process.env[envVarName] = value;
            return value;
        }
    }

    return undefined;
}

/** Returns true if the credential is already stored (env OR file). */
export function hasCredential(envVarName = 'LLM_API_KEY'): boolean {
    if (process.env[envVarName]) return true;
    return readStore()[envVarName] !== undefined;
}

/** Remove a stored credential from the encrypted file. */
export function clearCredential(envVarName = 'LLM_API_KEY'): void {
    const store = readStore();
    if (store[envVarName] === undefined) return;
    delete store[envVarName];
    writeStore(store);
    console.log(`[Security] Credential "${envVarName}" removed from store`);
}
