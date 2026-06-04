import { expect } from '@wdio/globals';
import { parseNaturalLanguage, parseCommand } from '../../src/agent/nlParser';
import { dispatch } from '../../src/agent/dispatcher';
import type { UiFunctions } from '../../src/agent/dispatcher';
import { idmPage } from '../pageobjects/IdmPage';

// ---------------------------------------------------------------------------
// Part 3 & 4: Agentic AI Automation Layer
// ---------------------------------------------------------------------------

// Wire the page-object methods into the UiFunctions interface expected by dispatch()
const idmUi: UiFunctions = {
    extractDownloads: ()      => idmPage.extractDownloads(),
    startDownload:    (item)  => idmPage.startDownload(item),
    pauseDownload:    (item)  => idmPage.pauseDownload(item),
    resumeDownload:   (item)  => idmPage.resumeDownload(item),
    deleteDownload:   (item)  => idmPage.deleteDownload(item),
    clearCompleted:   ()      => idmPage.clearCompleted(),
    addUrlDownload:   (url)   => idmPage.addUrlDownload(url),
};

/** Parse (LLM → regex fallback) → dispatch → log feedback. Returns the CommandResult. */
async function runNLCommand(naturalLanguageInput: string) {
    console.log(`\n[Agent] ▶ "${naturalLanguageInput}"`);
    const command = await parseCommand(naturalLanguageInput);
    console.log(`[Agent]   Parsed: ${JSON.stringify(command)}`);
    const result = await dispatch(command, idmUi);
    const icon = result.success ? '✓' : '✗';
    console.log(`[Agent] ${icon} ${result.message}`);
    return result;
}

// ---------------------------------------------------------------------------
// Part 3a — NL Parser unit tests (synchronous regex parser, no network needed)
// Note: WebdriverIO still requires a live WinAppDriver session to run this file.
//       To run parser tests in isolation, move them to a Vitest/Jest suite.
// ---------------------------------------------------------------------------

describe('NL Parser — unit tests', () => {

    it('parses "list all downloads"', () => {
        const cmd = parseNaturalLanguage('list all downloads');
        expect(cmd.action).toBe('list');
        expect(cmd.target).toBe('*');
    });

    it('parses "pause the first download"', () => {
        const cmd = parseNaturalLanguage('pause the first download');
        expect(cmd.action).toBe('pause');
        expect(cmd.index).toBe(0);
    });

    it('parses "resume ubuntu.iso"', () => {
        const cmd = parseNaturalLanguage('resume ubuntu.iso');
        expect(cmd.action).toBe('resume');
        expect(cmd.target).toBe('ubuntu.iso');
        expect(cmd.index).toBeUndefined();
    });

    it('parses "delete the last item"', () => {
        const cmd = parseNaturalLanguage('delete the last item');
        expect(cmd.action).toBe('delete');
        expect(cmd.index).toBe(-1);
    });

    it('parses "start 3rd download"', () => {
        const cmd = parseNaturalLanguage('start 3rd download');
        expect(cmd.action).toBe('start');
        expect(cmd.index).toBe(2);
    });

    it('parses "delete completed files" as clear (matches delete\\s*completed pattern)', () => {
        const cmd = parseNaturalLanguage('delete completed files');
        // ACTION_PATTERNS: /delete\s*completed/ → 'clear' fires before the generic 'delete' pattern.
        // "delete completed files" means "clear all completed downloads", not a named-file delete.
        expect(cmd.action).toBe('clear');
    });

    it('parses "show me all downloads" as list', () => {
        const cmd = parseNaturalLanguage('show me all downloads');
        expect(cmd.action).toBe('list');
    });

    it('parses "pause number 2"', () => {
        const cmd = parseNaturalLanguage('pause number 2');
        expect(cmd.action).toBe('pause');
        expect(cmd.index).toBe(1);
    });

    it('throws on unrecognised action', () => {
        expect(() => parseNaturalLanguage('juggle everything')).toThrow(
            /cannot determine action/i
        );
    });

    it('throws on empty input', () => {
        expect(() => parseNaturalLanguage('')).toThrow(/empty command/i);
    });
});

// ---------------------------------------------------------------------------
// Part 4 — End-to-end agentic tests (requires WinAppDriver + IDM running)
// ---------------------------------------------------------------------------

describe('IDM Agent — NL command execution', () => {

    before(async () => {
        await idmPage.waitForReady();
    });

    it('should list all downloads via natural language', async () => {
        const result = await runNLCommand('list all downloads');
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
    });

    it('should pause the first download via natural language', async function () {
        const downloads = await idmPage.extractDownloads();
        const hasActive = downloads.some(d =>
            ['downloading', 'in progress', 'connecting'].some(s =>
                d.status.toLowerCase().includes(s)
            )
        );

        if (!hasActive) {
            return this.skip();
        }

        const result = await runNLCommand('pause the first download');
        expect(result.success).toBe(true);
    });

    it('should resume the first paused download via natural language', async function () {
        const downloads = await idmPage.extractDownloads();
        const hasPaused = downloads.some(d =>
            ['paused', 'stopped', 'queued'].some(s =>
                d.status.toLowerCase().includes(s)
            )
        );

        if (!hasPaused) {
            return this.skip();
        }

        const result = await runNLCommand('resume the first download');
        expect(result.success).toBe(true);
    });

    it('should handle an unknown filename gracefully', async () => {
        const result = await runNLCommand('pause zzz_nonexistent_file_xyz.bin');
        // Should fail gracefully with a descriptive message, not throw
        expect(result.success).toBe(false);
        expect(result.message.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// Part 3b — LLM Parser unit tests (parseCommand — LLM with regex fallback)
// These pass whether or not LLM_API_KEY is set:
//   · With key:    LLM handles complex/Korean phrasing
//   · Without key: regex fallback handles what it can; Korean tests may produce
//                  less precise targets but must not throw
// ---------------------------------------------------------------------------

describe('LLM Parser — parseCommand unit tests', () => {

    it('parses Korean conversational pause: "야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?"', async () => {
        const cmd = await parseCommand('야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?');
        expect(cmd.action).toBe('pause');
        // LLM should extract "우분투" as the target; regex fallback returns a non-empty string
        expect(typeof cmd.target).toBe('string');
    });

    it('parses Korean list command: "다운로드 목록 좀 싹 다 보여줘"', async () => {
        const cmd = await parseCommand('다운로드 목록 좀 싹 다 보여줘');
        expect(cmd.action).toBe('list');
        expect(cmd.target).toBe('*');
    });

    it('parses Korean delete-last: "맨 마지막에 받기 시작한 거 취소해"', async () => {
        const cmd = await parseCommand('맨 마지막에 받기 시작한 거 취소해');
        expect(cmd.action).toBe('delete');
        expect(cmd.index).toBe(-1);
    });

    it('parses Korean resume-second: "두 번째 파일 다시 시작해줘"', async () => {
        const cmd = await parseCommand('두 번째 파일 다시 시작해줘');
        expect(cmd.action).toBe('resume');
        expect(cmd.index).toBe(1);
    });

    it('parses conversational English: "can you please stop my first download?"', async () => {
        const cmd = await parseCommand('can you please stop my first download?');
        expect(cmd.action).toBe('pause');
        expect(cmd.index).toBe(0);
    });

    it('parses implicit list: "what files are currently downloading?"', async () => {
        const cmd = await parseCommand('what files are currently downloading?');
        expect(cmd.action).toBe('list');
    });

    it('throws on empty input even with LLM path', async () => {
        await expect(parseCommand('')).rejects.toThrow(/empty command/i);
    });
});
