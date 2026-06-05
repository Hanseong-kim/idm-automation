import 'dotenv/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
import { remote } from 'webdriverio';
import { parseCommand, setProvider, getProvider } from './agent/nlParser';
import type { AiProvider } from './agent/nlParser';
import { dispatch } from './agent/dispatcher';
import type { UiFunctions } from './agent/dispatcher';
import type { IdmCommand, ActionType, DownloadItem } from './agent/types';
import { IdmPage } from '../test/pageobjects/IdmPage';
import { ExecutionMonitor } from './monitoring/executionMonitor';
import { generatePlan, printPlan } from './planning/taskPlanner';
import { discoverWorkflows, printWorkflowDiagram } from './discovery/workflowDiscovery';
import { scanApplication, printScanResult } from './discovery/appScanner';
import { getApiKey } from './security/credentialManager';
import { getRecentHistory, getStats } from './database/executionHistory';
import { IdmPlugin } from './plugins/IdmPlugin';
import { registerPlugin, listPlugins } from './plugins/PluginRegistry';
import { VoiceInput } from './voice/voiceInput';

// ---------------------------------------------------------------------------
// Session bootstrap
// ---------------------------------------------------------------------------

async function createSession() {
    return remote({
        hostname: '127.0.0.1',
        port: 4724,
        path: '/',
        logLevel: 'warn',
        capabilities: {
            platformName: 'Windows',
            'appium:automationName': 'Windows',
            'appium:app': 'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe',
            'appium:appWorkingDir': 'C:\\Program Files (x86)\\Internet Download Manager',
            'appium:newCommandTimeout': 3600,
        } as WebdriverIO.Capabilities,
    });
}

// ---------------------------------------------------------------------------
// Session PIN guard
// AGENT_PIN env var must hold the SHA-256 hex digest of the correct PIN.
// Generate it with: node -e "const c=require('crypto'); console.log(c.createHash('sha256').update('1234').digest('hex'))"
// ---------------------------------------------------------------------------

async function checkSessionPin(): Promise<void> {
    const storedHash = process.env['AGENT_PIN'];
    if (!storedHash) return; // PIN not configured — skip

    const ask = (msg: string): Promise<string> =>
        new Promise(resolve => {
            const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
            rl2.question(msg, (ans: string) => { rl2.close(); resolve(ans.trim()); });
        });

    for (let attempt = 1; attempt <= 3; attempt++) {
        const input = await ask(`[Security] Enter session PIN (attempt ${attempt}/3): `);
        const hash  = crypto.createHash('sha256').update(input).digest('hex');
        if (hash === storedHash) {
            console.log('[Security] PIN verified.\n');
            return;
        }
        if (attempt < 3) console.log('[Security] Incorrect PIN — try again.');
    }

    console.error('[Security] 3 failed attempts — access denied.');
    process.exit(1);
}

// ---------------------------------------------------------------------------
// Performance measurement helper
// ---------------------------------------------------------------------------

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
    const start = Date.now();
    const result = await fn();
    return [result, Date.now() - start];
}

// ---------------------------------------------------------------------------
// Screenshot utility (Priority 2)
// ---------------------------------------------------------------------------

async function captureScreenshot(browserInst: WebdriverIO.Browser, tag: string): Promise<void> {
    try {
        const dir = path.join(process.cwd(), 'screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(dir, `${tag}-${stamp}.png`);
        await browserInst.saveScreenshot(filePath);
        console.log(`  [📷] Screenshot: screenshots/${tag}-${stamp}.png`);
    } catch {
        // Non-fatal — screenshot failures don't abort automation
    }
}

// ---------------------------------------------------------------------------
// Undo inversion table
// ---------------------------------------------------------------------------

const UNDO_MAP: Partial<Record<ActionType, ActionType>> = {
    pause:  'resume',
    resume: 'pause',
    start:  'pause',
};

// ---------------------------------------------------------------------------
// REPL banner
// ---------------------------------------------------------------------------

const BANNER = `
+----------------------------------------------------------+
|          IDM AI Agent — Interactive Console              |
+----------------------------------------------------------+
|  Download commands:                                      |
|    list all downloads                                    |
|    pause / resume / start / delete <file or ordinal>    |
|    clear all completed                                   |
|                                                          |
|  Discovery & History:                                    |
|    discover / workflows  — live UI scan + workflow map  |
|    screenshot            — capture current IDM screen    |
|    history               — last 10 executed commands    |
|    stats                 — success rate and usage stats |
|    plugins               — list registered app plugins  |
|    model [gemini|ollama|regex] — switch AI parser        |
|                                                          |
|  Voice input:                                            |
|    voice start/stop      — watch voice-input.txt        |
|                                                          |
|  Memory:                                                 |
|    repeat / do it again  — re-run last command           |
|    undo                  — invert last action            |
|                                                          |
|  Batch: use "and" or "then" between commands             |
|  Type "exit" or "quit" to close.                        |
+----------------------------------------------------------+
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log(BANNER);

    // Session PIN check (skipped if AGENT_PIN env var is not set)
    await checkSessionPin();

    // LLM key: env → encrypted store → interactive prompt (TTY only)
    await getApiKey('LLM_API_KEY');

    // Register plugins
    registerPlugin(new IdmPlugin());

    let browser: WebdriverIO.Browser;
    try {
        process.stdout.write('Connecting to IDM via Appium... ');
        browser = await createSession();
        console.log('Connected.\n');
    } catch (err) {
        console.error('Failed to start session:', err instanceof Error ? err.message : err);
        console.error('Make sure Appium is running on port 4724 and IDM is installed.');
        process.exit(1);
    }

    const g = globalThis as Record<string, unknown>;
    g['browser'] = browser;
    g['$'] = browser.$.bind(browser);
    g['$$'] = browser.$$.bind(browser);

    const page  = new IdmPage();
    const monitor = new ExecutionMonitor();
    const voice = new VoiceInput();

    const ui: UiFunctions = {
        extractDownloads: ()     => page.extractDownloads(),
        startDownload:    (item) => page.startDownload(item),
        pauseDownload:    (item) => page.pauseDownload(item),
        resumeDownload:   (item) => page.resumeDownload(item),
        deleteDownload:   (item) => page.deleteDownload(item),
        clearCompleted:   ()     => page.clearCompleted(),
        addUrlDownload:   (url)  => page.addUrlDownload(url),
    };

    const commandHistory: IdmCommand[] = [];
    let exiting = false;

    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
    });

    // Sequential async queue — ensures piped stdin commands execute in order
    // even though rl.on('line') fires synchronously for each buffered line.
    const lineQueue: string[] = [];
    let draining = false;

    async function drainQueue(): Promise<void> {
        if (draining) return;
        draining = true;
        while (lineQueue.length > 0 && !exiting) {
            const line = lineQueue.shift()!;
            try {
                await handleLine(line);
            } catch (err) {
                console.error('[Error]', err instanceof Error ? err.message : err);
            }
        }
        draining = false;
    }

    const showPrompt = () => { if (!exiting) process.stdout.write('\nAgent > '); };

    // -----------------------------------------------------------------------
    // Execute one parsed command with plan display + monitoring
    // -----------------------------------------------------------------------
    async function executeCommand(command: IdmCommand, rawText: string, parseMs = 0): Promise<void> {

        console.log('\n================================================================================');
        console.log(`[🚀 New Command] User Input: "${rawText}"`);
        console.log('================================================================================');
        console.log(
            `[AI Intent] Action: ${command.action}, Target: ${command.target}` +
            (command.index !== undefined ? `, Index: ${command.index}` : '')
        );

        // Show step-by-step plan before execution
        const [plan, planMs] = await timed(async () => generatePlan(command, rawText));
        printPlan(plan);

        // Take a before-screenshot (Priority 2)
        const [, shotBeforeMs] = await timed(() => captureScreenshot(browser, `before-${command.action}`));

        // Execute with monitoring + DB recording
        monitor.startCommand(rawText);
        const [result, dispatchMs] = await timed(() => dispatch(command, ui, monitor, rawText));
        monitor.endCommand(rawText, result.success);

        // Take an after-screenshot
        const [, shotAfterMs] = await timed(() => captureScreenshot(browser, `after-${command.action}`));

        const icon = result.success ? '✓' : '✗';
        console.log(`[Result] ${icon} ${result.message}`);

        const processingMs = parseMs + planMs;
        const totalShotMs  = shotBeforeMs + shotAfterMs;
        console.log('[Perf] ' +
            `parse: ${parseMs}ms | plan: ${planMs}ms | dispatch: ${dispatchMs}ms | ` +
            `screenshots: ${totalShotMs}ms`);
        console.log(`[Perf] command processing (parse+plan): ${processingMs}ms ` +
            `(pdf target <3000ms: ${processingMs < 3000 ? 'PASS' : 'OVER'})`);

        console.log('================================================================================\n');

        if (result.success) {
            commandHistory.push({ ...command });
        }
    }

    // follow-up 대기 중 플래그 — true이면 메인 rl 핸들러가 stdin 입력을 큐에 넣지 않는다.
    let awaitingFollowup = false;

    // 메인 rl을 재사용해 한 줄만 가로채는 일회성 입력 헬퍼.
    // prependOnceListener로 메인 'line' 핸들러보다 먼저 실행돼 입력을 소비한다.
    function askOnce(msg: string): Promise<string> {
        return new Promise(resolve => {
            process.stdout.write(msg);
            awaitingFollowup = true;
            const onLine = (line: string) => {
                resolve(line.trim());
                // setTimeout으로 리셋을 지연 — 이 콜백 직후 동기로 실행되는
                // 메인 'line' 핸들러가 awaitingFollowup=true를 보고 큐 삽입을 건너뛴다.
                setTimeout(() => { awaitingFollowup = false; }, 0);
            };
            rl.prependOnceListener('line', onLine);
        });
    }

    // 액션별로 실제 대상이 될 수 있는 항목만 거른다.
    const isCompleted = (d: DownloadItem) =>
        ['complete', 'done', 'finished', '100%'].some(s => d.status.toLowerCase().includes(s));
    const isNotFound  = (d: DownloadItem) =>
        /not\s*found|error|virus/i.test(d.status);

    function candidatesFor(action: ActionType, downloads: DownloadItem[]): DownloadItem[] {
        switch (action) {
            case 'resume':
            case 'start':
                return downloads.filter(d => !d.isTransferring && !isCompleted(d) && !isNotFound(d));
            case 'pause':
                return downloads.filter(d => d.isTransferring);
            case 'delete':
                return downloads;
            default:
                return downloads;
        }
    }

    // -----------------------------------------------------------------------
    // Process one sub-command (handles special keywords, then NLP)
    // -----------------------------------------------------------------------
    async function runSubCommand(text: string, isBatch = false): Promise<void> {
        const t = text.trim();
        if (!t) return;

        // 모델 선택
        const modelMatch = t.match(/^model(?:\s+(gemini|ollama|regex))?$/i);
        if (modelMatch) {
            const arg = modelMatch[1]?.toLowerCase() as AiProvider | undefined;
            if (!arg) {
                console.log(`[Model] Current: ${getProvider()}`);
                console.log('[Model] Available: gemini | ollama | regex');
                console.log('[Model] Usage: model gemini');
            } else {
                setProvider(arg);
                console.log(`[Model] Switched to: ${arg}` +
                    (arg === 'regex'  ? ' (LLM skipped — fast, no quota)' :
                     arg === 'ollama' ? ' (local llama3 — requires ollama serve)' :
                                       ' (Google Gemini 2.5 Flash)'));
            }
            return;
        }

        // Plugin registry
        if (/^plugins$/i.test(t)) {
            const names = listPlugins();
            console.log('Registered plugins:', names.length ? names.join(', ') : '(none)');
            return;
        }

        // Voice input
        if (/^voice\s+start$/i.test(t)) {
            if (voice.isActive()) {
                console.log('[Voice] Already active.');
            } else {
                voice.start((cmd: string) => {
                    console.log(`\n[Voice] Running: "${cmd}"`);
                    runSubCommand(cmd).catch((e: unknown) =>
                        console.error('[Voice] Error:', e instanceof Error ? e.message : e)
                    );
                });
            }
            return;
        }

        if (/^voice\s+stop$/i.test(t)) {
            voice.stop();
            return;
        }

        // Execution history
        if (/^history$/i.test(t)) {
            const rows = getRecentHistory(10);
            if (rows.length === 0) {
                console.log('[History] No commands recorded yet.');
                return;
            }
            console.log(`\n[History] Last ${rows.length} command(s):\n`);
            rows.forEach(r => {
                const icon   = r.success ? '✓' : '✗';
                const time   = new Date(r.timestamp).toLocaleTimeString();
                const target = r.target && r.target !== '*' ? ` → "${r.target}"` : '';
                console.log(`  [${icon}] [${time}] ${r.command_text}  (${r.duration_ms}ms)${r.error_message ? '  ' + r.error_message : ''}`);
                console.log(`        action: ${r.action}${target}`);
            });
            console.log('');
            return;
        }

        // Execution stats
        if (/^stats$/i.test(t)) {
            const s = getStats();
            console.log('\n[Stats] Execution Statistics\n');
            console.log(`  Total commands   : ${s.total}`);
            console.log(`  Successful       : ${s.successCount} (${s.successRate}%)`);
            console.log(`  Most used action : ${s.mostUsedAction}`);
            console.log(`  Avg duration     : ${s.avgDurationMs}ms`);
            console.log('');
            return;
        }

        // Workflow discovery — live scan first, then static diagram
        if (/^(discover|workflows?|show\s+workflow|ui\s+map)$/i.test(t)) {
            let scanMs = 0;
            let scanOk = true;
            try {
                const [scan, ms] = await timed(() => scanApplication());
                scanMs = ms;
                printScanResult(scan);
            } catch (scanErr) {
                scanOk = false;
                console.log('[Scanner] Live scan failed:', scanErr instanceof Error ? scanErr.message : scanErr);
                console.log('[Scanner] Falling back to static workflow diagram');
            }
            const [map, genMs] = await timed(async () => discoverWorkflows());
            printWorkflowDiagram(map);

            const totalMs = scanMs + genMs;
            console.log('[Perf] ' +
                `scan: ${scanMs}ms${scanOk ? '' : ' (failed)'} | workflow-gen: ${genMs}ms`);
            console.log(`[Perf] workflow generation total: ${totalMs}ms ` +
                `(pdf target <10000ms: ${totalMs < 10000 ? 'PASS' : 'OVER'})`);
            return;
        }

        // Manual screenshot
        if (/^screenshot$/i.test(t)) {
            await captureScreenshot(browser, 'manual');
            return;
        }

        // Memory: repeat
        if (/^(?:repeat|do\s+it\s+again|again)$/i.test(t)) {
            if (commandHistory.length === 0) {
                console.log('[Agent] No previous command to repeat.');
                return;
            }
            const last = commandHistory[commandHistory.length - 1];
            const label = [
                last.action,
                last.target !== '*' ? `"${last.target}"` : '',
                last.index !== undefined ? `#${last.index + 1}` : '',
            ].filter(Boolean).join(' ');
            console.log(`[Agent] Repeating: ${label}`);
            await executeCommand(last, `repeat: ${label}`, 0);
            return;
        }

        // Memory: undo
        if (/^undo$/i.test(t)) {
            if (commandHistory.length === 0) {
                console.log('[Agent] No command to undo.');
                return;
            }
            const last = commandHistory[commandHistory.length - 1];
            const inverseAction = UNDO_MAP[last.action];
            if (!inverseAction) {
                console.log(
                    `[Agent] Cannot undo "${last.action}" — ` +
                    'this action is irreversible (delete / clear / list).'
                );
                return;
            }
            console.log(`[Agent] Undoing: ${last.action} → ${inverseAction}`);
            await executeCommand({ ...last, action: inverseAction }, `undo: ${last.action}`, 0);
            return;
        }

        // Normal NLP parse → plan → dispatch
        const [command, parseMs] = await timed(() => parseCommand(t));

        // follow-up: 대상이 필요한 액션인데 모호하면 번호로 되묻기 (batch 시 비활성)
        const NEEDS_TARGET: ActionType[] = ['pause', 'resume', 'start', 'delete'];
        const isAmbiguous =
            NEEDS_TARGET.includes(command.action) &&
            command.index === undefined &&
            (!command.target || command.target === '*' || command.target.toLowerCase() === 'all');

        if (isAmbiguous && !isBatch) {
            const downloads = await ui.extractDownloads();
            const candidates = candidatesFor(command.action, downloads);
            if (candidates.length === 0) {
                console.log(`[Agent] No downloads available to ${command.action}.`);
                return;
            }
            if (candidates.length === 1) {
                // 후보 하나 — 되묻지 않고 확정 (원본 배열 인덱스 사용)
                command.index = candidates[0].index;
            } else {
                // 여러 개 — 번호 목록 보여주고 선택받기
                console.log(`\n[Agent] Which download do you want to ${command.action}?`);
                candidates.forEach((d, i) => {
                    console.log(`  ${i + 1}) ${d.fileName}  [${d.status}]`);
                });
                const answer = await askOnce(`Enter number (1-${candidates.length}, or anything else to cancel): `);
                const choice = parseInt(answer, 10);
                if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
                    console.log('[Agent] Cancelled — no valid selection.');
                    return;
                }
                const chosen = candidates[choice - 1];
                command.index = chosen.index;  // 전체 downloads 기준 원본 인덱스
                console.log(`[Agent] Selected: ${chosen.fileName}`);
            }
        }

        await executeCommand(command, t, parseMs);
    }

    // -----------------------------------------------------------------------
    // Top-level handler: splits batch input, runs each sub-command
    // -----------------------------------------------------------------------
    async function handleLine(input: string): Promise<void> {
        const text = input.trim();

        if (!text) {
            showPrompt();
            return;
        }

        if (/^(exit|quit)$/i.test(text)) {
            exiting = true;
            if (voice.isActive()) voice.stop();
            console.log('\n[Session closing...]');
            rl.close();
            await browser.deleteSession();
            console.log('[Goodbye.]');
            process.exit(0);
            return;
        }

        const subcommands = text.split(/\s+(?:and|then)\s+/i).map(s => s.trim()).filter(Boolean);

        for (const sub of subcommands) {
            if (subcommands.length > 1) {
                console.log(`\n[Batch] → "${sub}"`);
            }
            try {
                await runSubCommand(sub, subcommands.length > 1);
            } catch (err) {
                console.error('[Error]', err instanceof Error ? err.message : err);
            }
        }

        showPrompt();
    }

    rl.on('line', (input: string) => {
        if (awaitingFollowup) return;  // follow-up 입력 중 — 큐에 넣지 않음
        lineQueue.push(input);
        drainQueue();
    });

    showPrompt();
}

main();
