import 'dotenv/config';
import readline from 'readline';
import { remote } from 'webdriverio';
import { parseCommand } from './agent/nlParser';
import { dispatch } from './agent/dispatcher';
import type { UiFunctions } from './agent/dispatcher';
import type { IdmCommand, ActionType } from './agent/types';
import { IdmPage } from '../test/pageobjects/IdmPage';

// ---------------------------------------------------------------------------
// Standalone session bootstrap
// Mirrors wdio.conf.ts: WebdriverIO → Appium proxy (4724) → WinAppDriver
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
// Undo inversion table
// Maps an action to the action that logically reverses it.
// Actions absent from this map (delete, clear, list) are irreversible.
// ---------------------------------------------------------------------------

const UNDO_MAP: Partial<Record<ActionType, ActionType>> = {
    pause:  'resume',
    resume: 'pause',
    start:  'pause',
};

// ---------------------------------------------------------------------------
// REPL loop
// ---------------------------------------------------------------------------

const BANNER = `
+----------------------------------------------------------+
|          IDM AI Agent — Interactive Console              |
+----------------------------------------------------------+
|  Basic commands:                                         |
|    list all downloads                                    |
|    pause <file or ordinal>                               |
|    resume <file or ordinal>                              |
|    start <file or ordinal>                               |
|    delete <file or ordinal>                              |
|    clear all completed                                   |
|                                                          |
|  Memory:                                                 |
|    repeat / do it again  — re-run last command           |
|    undo                  — invert last action            |
|                          (pause↔resume, start→pause)    |
|                                                          |
|  Batch (use "and" or "then" between commands):           |
|    pause first download and delete the second            |
|    resume ubuntu.iso then list all downloads             |
|                                                          |
|  Korean is supported. Type "exit" or "quit" to close.   |
+----------------------------------------------------------+
`;

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

    // Inject WebdriverIO globals so IdmPage (which uses bare `browser` and `$`)
    // works outside the wdio test runner
    const g = globalThis as Record<string, unknown>;
    g['browser'] = browser;
    g['$'] = browser.$.bind(browser);
    g['$$'] = browser.$$.bind(browser);

    const page = new IdmPage();

    const ui: UiFunctions = {
        extractDownloads: ()     => page.extractDownloads(),
        startDownload:    (item) => page.startDownload(item),
        pauseDownload:    (item) => page.pauseDownload(item),
        resumeDownload:   (item) => page.resumeDownload(item),
        deleteDownload:   (item) => page.deleteDownload(item),
        clearCompleted:   ()     => page.clearCompleted(),
    };

    // Running history of successfully dispatched commands (most-recent last).
    const commandHistory: IdmCommand[] = [];

    const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
    });

    const prompt = () => rl.question('Agent > ', handleLine);

    // -----------------------------------------------------------------------
    // Execute one parsed command and record it in history on success.
    // -----------------------------------------------------------------------
    async function executeCommand(command: IdmCommand): Promise<void> {
        console.log(
            `[AI Intent] Action: ${command.action}, Target: ${command.target}` +
            (command.index !== undefined ? `, Index: ${command.index}` : '')
        );
        const result = await dispatch(command, ui);
        const icon = result.success ? '✓' : '✗';
        console.log(`[Result] ${icon} ${result.message}`);
        if (result.success) {
            commandHistory.push({ ...command });
        }
    }

    // -----------------------------------------------------------------------
    // Process one sub-command string (after batch splitting).
    // Handles special keywords (repeat, undo) before falling through to NLP.
    // -----------------------------------------------------------------------
    async function runSubCommand(text: string): Promise<void> {
        const t = text.trim();
        if (!t) return;

        // --- Memory: repeat ------------------------------------------------
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
            await executeCommand(last);
            return;
        }

        // --- Memory: undo --------------------------------------------------
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
            await executeCommand({ ...last, action: inverseAction });
            return;
        }

        // --- Normal NLP parse → dispatch ------------------------------------
        const command = await parseCommand(t);
        await executeCommand(command);
    }

    // -----------------------------------------------------------------------
    // Top-level handler: splits batch input, then runs each sub-command.
    // -----------------------------------------------------------------------
    async function handleLine(input: string): Promise<void> {
        const text = input.trim();

        if (!text) {
            prompt();
            return;
        }

        if (/^(exit|quit)$/i.test(text)) {
            console.log('\n[Session closing...]');
            rl.close();
            await browser.deleteSession();
            console.log('[Goodbye.]');
            process.exit(0);
        }

        // Batch: split on conjunctions " and " / " then " (case-insensitive).
        // Each sub-command is run sequentially; an error in one does not abort the rest.
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

        console.log('');
        prompt();
    }

    prompt();
}

main();
