import { expect } from '@wdio/globals';
import { idmPage } from '../pageobjects/IdmPage';

// ---------------------------------------------------------------------------
// Part 1 & 2: UI Automation Layer
// Requires: WinAppDriver running + IDM installed
// ---------------------------------------------------------------------------

describe('IDM — UI Automation', () => {

    before(async () => {
        await idmPage.waitForReady();
    });

    // -----------------------------------------------------------------------
    // Part 1: Window & list verification
    // -----------------------------------------------------------------------

    it('should launch IDM and verify the main window is accessible', async () => {
        // '~name' in WinAppDriver maps to UIA AutomationId, not the window title.
        // getTitle() returns the UIA Name (window title) of the session root — use that instead.
        const title = await browser.getTitle();
        expect(title.toLowerCase()).toContain('internet download manager');
        console.log(`IDM main window found. Title: "${title}"`);
    });

    it('should extract downloads and print structured data', async () => {
        const downloads = await idmPage.extractDownloads();

        console.log(`Found ${downloads.length} download(s):`);
        downloads.forEach(d => {
            console.log(`  [${d.index + 1}] ${d.fileName} | ${d.size} | ${d.status} | ${d.progress}`);
        });

        // The list may be empty if no downloads are queued — that is valid.
        expect(Array.isArray(downloads)).toBe(true);
        downloads.forEach(d => {
            expect(typeof d.fileName).toBe('string');
            expect(typeof d.status).toBe('string');
        });
    });

    // -----------------------------------------------------------------------
    // Part 2: Interaction functions (conditional on available downloads)
    // -----------------------------------------------------------------------

    it('should pause the first active download', async function () {
        const downloads = await idmPage.extractDownloads();
        const active = downloads.find(d =>
            ['downloading', 'in progress', 'connecting'].some(s =>
                d.status.toLowerCase().includes(s)
            )
        );

        if (!active) return this.skip();

        await idmPage.pauseDownload(active);
        console.log(`"${active.fileName}" paused successfully.`);
    });

    it('should resume the first paused download', async function () {
        const downloads = await idmPage.extractDownloads();
        const paused = downloads.find(d =>
            ['paused', 'stopped', 'queued'].some(s =>
                d.status.toLowerCase().includes(s)
            )
        );

        if (!paused) return this.skip();

        await idmPage.resumeDownload(paused);
        console.log(`"${paused.fileName}" resumed successfully.`);
    });

    it('should start the first queued download', async function () {
        const downloads = await idmPage.extractDownloads();
        const queued = downloads.find(d =>
            ['queued', 'scheduled'].some(s =>
                d.status.toLowerCase().includes(s)
            )
        );

        if (!queued) return this.skip();

        await idmPage.startDownload(queued);
        console.log(`"${queued.fileName}" started successfully.`);
    });
});
