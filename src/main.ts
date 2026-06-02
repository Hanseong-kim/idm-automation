import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
import { remote } from 'webdriverio';
import { parseCommand } from './agent/nlParser';
import { dispatch } from './agent/dispatcher';
import type { UiFunctions } from './agent/dispatcher';
import type { IdmCommand, ActionType } from './agent/types';
import { IdmPage } from '../test/pageobjects/IdmPage';
import { ExecutionMonitor } from './monitoring/executionMonitor';
import { generatePlan, printPlan } from './planning/taskPlanner';
import { discoverWorkflows, printWorkflowDiagram } from './discovery/workflowDiscovery';

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
|    pause <file or ordinal>                               |
|    resume <file or ordinal>                              |
|    start <file or ordinal>                               |
|    delete <file or ordinal>                              |
|    clear all completed                                   |
|                                                          |
|  Discovery & Planning:                                   |
|    discover / workflows  — show IDM workflow map         |
|    screenshot            — capture current IDM screen    |
|                                                          |
|  Memory:                                                 |
|    repeat / do it again  — re-run last command           |
|    undo                  — invert last action            |
|                                                          |
|  Batch (use "and" or "then" between commands):           |
|    pause first download and delete the second            |
|    resume ubuntu.iso then list all downloads             |
|                                                          |
|  Korean is supported. Type "exit" or "quit" to close.   |
+----------------------------------------------------------+
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log(BANNER);

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

    const page = new IdmPage();
    const monitor = new ExecutionMonitor();

    const ui: UiFunctions = {
        extractDownloads: ()     => page.extractDownloads(),
        startDownload:    (item) => page.startDownload(item),
        pauseDownload:    (item) => page.pauseDownload(item),
        resumeDownload:   (item) => page.resumeDownload(item),
        deleteDownload:   (item) => page.deleteDownload(item),
        clearCompleted:   ()     => page.clearCompleted(),
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
    async function executeCommand(command: IdmCommand, rawText: string): Promise<void> {
        console.log(
            `[AI Intent] Action: ${command.action}, Target: ${command.target}` +
            (command.index !== undefined ? `, Index: ${command.index}` : '')
        );

        // Show step-by-step plan before execution
        const plan = generatePlan(command, rawText);
        printPlan(plan);

        // Take a before-screenshot (Priority 2)
        await captureScreenshot(browser, `before-${command.action}`);

        // Execute with monitoring
        monitor.startCommand(rawText);
        const result = await dispatch(command, ui, monitor);
        monitor.endCommand(rawText, result.success);

        // Take an after-screenshot
        await captureScreenshot(browser, `after-${command.action}`);

        const icon = result.success ? '✓' : '✗';
        console.log(`[Result] ${icon} ${result.message}`);

        if (result.success) {
            commandHistory.push({ ...command });
        }
    }

    // -----------------------------------------------------------------------
    // Process one sub-command (handles special keywords, then NLP)
    // -----------------------------------------------------------------------
    async function runSubCommand(text: string): Promise<void> {
        const t = text.trim();
        if (!t) return;

        // Workflow discovery
        if (/^(discover|workflows?|show\s+workflow|ui\s+map)$/i.test(t)) {
            const map = discoverWorkflows();
            printWorkflowDiagram(map);
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
            await executeCommand(last, `repeat: ${label}`);
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
            await executeCommand({ ...last, action: inverseAction }, `undo: ${last.action}`);
            return;
        }

        // Normal NLP parse → plan → dispatch
        const command = await parseCommand(t);
        await executeCommand(command, t);
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
                await runSubCommand(sub);
            } catch (err) {
                console.error('[Error]', err instanceof Error ? err.message : err);
            }
        }

        showPrompt();
    }

    rl.on('line', (input: string) => {
        lineQueue.push(input);
        drainQueue();
    });

    showPrompt();
}

main();
