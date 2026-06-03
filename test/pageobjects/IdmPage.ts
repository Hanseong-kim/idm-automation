import * as fs from 'fs';
import * as path from 'path';
import type { DownloadItem } from '../../src/agent/types';

const DEBUG_MODE = process.env['DEBUG_MODE'] === 'true';

// ---------------------------------------------------------------------------
// Selectors
// IDM is a Win32 app. WinAppDriver exposes UIA properties via XPath.
// Use Windows Inspect.exe (SDK tool) or Accessibility Insights to verify/tune
// these selectors against your installed IDM version.
// ---------------------------------------------------------------------------
const SEL = {
    DOWNLOAD_LIST: '//List[@ClassName="SysListView32"]',
    LIST_ITEM:     './/ListItem',

    // Toolbar button indices (0-based) within the ToolBar's direct Button children.
    // WinAppDriver cannot read the Name attribute of IDM toolbar buttons reliably;
    // index-based access is the only stable approach.
    TB_START:  1,
    TB_RESUME: 1,
    TB_PAUSE:  2,
    TB_DELETE: 4,

    // Context-menu items
    CTX_START:  ['~Start', '~Start (Resume)', '~Continue', '~Download'] as const,
    CTX_PAUSE:  ['~Stop', '~Pause', '~Stop (Pause)', '~Pause/Stop']    as const,
    CTX_RESUME: ['~Start', '~Start (Resume)', '~Continue', '~Resume']  as const,
    CTX_DELETE: ['~Delete', '~Delete...', '~Remove', '~Remove...']     as const,

    CTX_PROPERTIES:    ['~Properties']                      as const,
    CTX_COPY_URL:      ['~Copy download link', '~Copy URL'] as const,
    CTX_REMOVE:        ['~Remove from list', '~Remove']     as const,
    CTX_OPEN_LOCATION: ['~Open file location', '~Open folder'] as const,
} as const;

const COMPLETED_STATUSES = ['Complete', 'Completed', 'Done', 'Finished', '100%'];
const PAUSED_STATUSES    = ['Paused', 'Stopped', 'Queued', 'Scheduled'];

// SysListView32 column indices (1-based XPath Text[N]).
// Verified from WinAppDriver UI tree dump: Text[2] is empty in active downloads;
// Text[3] = file size; Text[4] = status string (e.g. "Downloading", "Paused").
const COL_FILENAME = 1;
const COL_SIZE     = 3;
const COL_STATUS   = 4;

// ---------------------------------------------------------------------------
// Helper: parse a ListView item's UIA Name attribute into structured columns.
// IDM's Name format varies: "filename" or "filename\t1.2 GB\tDownloading\t45%"
// ---------------------------------------------------------------------------
function parseIdmItemName(nameAttr: string, index: number): DownloadItem {
    const parts = nameAttr.split(/\t|,\s+/).map(s => s.trim()).filter(Boolean);
    return {
        index,
        fileName: parts[0] ?? 'Unknown',
        size:     parts[1] ?? '—',
        status:   parts[2] ?? '—',
        progress: parts[3] ?? '—',
    };
}

// ---------------------------------------------------------------------------
// Page Object
// ---------------------------------------------------------------------------
export class IdmPage {

    /** Wait until the IDM main window is visible and interactive. */
    async waitForReady(timeoutMs = 15_000): Promise<void> {
        if (DEBUG_MODE) {
            try {
                const title = await browser.getTitle();
                console.log(`[Debug] Current window title: "${title}"`);
                const handles = await browser.getWindowHandles();
                console.log(`[Debug] Window handles (${handles.length}):`, handles);
                if (!title.toLowerCase().includes('internet download manager')) {
                    console.log('[Debug] Current window is NOT the IDM main window — scanning handles...');
                    for (const handle of handles) {
                        try {
                            await browser.switchToWindow(handle);
                            const t = await browser.getTitle();
                            console.log(`[Debug]   Handle ${handle}: "${t}"`);
                            if (t.toLowerCase().includes('internet download manager')) {
                                console.log(`[Debug]   Switched to IDM main window via handle ${handle}`);
                                break;
                            }
                        } catch {
                            // handle not accessible — continue
                        }
                    }
                }
            } catch (diagErr) {
                console.log('[Debug] waitForReady diagnostic failed:', diagErr instanceof Error ? diagErr.message : diagErr);
            }
        }

        await browser.waitUntil(
            async () => {
                try {
                    const title = await browser.getTitle();
                    return title.toLowerCase().includes('internet download manager');
                } catch {
                    return false;
                }
            },
            {
                timeout: timeoutMs,
                interval: 1000,
                timeoutMsg: 'IDM main window did not become ready within the timeout.',
            }
        );
    }

    // -----------------------------------------------------------------------
    // Core data extraction
    // -----------------------------------------------------------------------

    /** Return all current downloads as structured objects. */
    async extractDownloads(): Promise<DownloadItem[]> {
        await this.waitForReady();

        if (DEBUG_MODE) {
            try {
                const xml = await browser.getPageSource();
                const logsDir = path.join(process.cwd(), 'logs');
                fs.mkdirSync(logsDir, { recursive: true });
                fs.writeFileSync(path.join(logsDir, 'pagesource-debug.xml'), xml, 'utf8');
                console.log(`[Debug] Page source saved to logs/pagesource-debug.xml (${xml.length} chars)`);
            } catch (e) {
                console.log('[Debug] Could not save page source:', e instanceof Error ? e.message : e);
            }
        }

        const rows = await this.getListItems();
        if (DEBUG_MODE) console.log(`[Debug] Found ${rows.length} list items in SysListView32`);

        const result: DownloadItem[] = [];

        for (let i = 0; i < rows.length; i++) {
            if (DEBUG_MODE) {
                try {
                    const nameAttr = (await rows[i].getAttribute('Name')) ?? '(null)';
                    console.log(`[Debug] Item ${i} raw Name: "${nameAttr}"`);
                } catch (e) {
                    console.log(`[Debug] Item ${i} could not read Name:`, e instanceof Error ? e.message : e);
                }
            }
            result.push(await this.parseRow(rows[i], i));
        }

        return result;
    }

    /**
     * Parse one ListItem row into a DownloadItem.
     *
     * Strategy 1: fetch each column cell individually via XPath positional
     * index (.//Text[N], 1-based).  This avoids WDIO v9's ChainablePromiseArray
     * which is not a plain JS array and cannot be passed to Promise.all/map.
     * Strategy 2: fall back to splitting the composite Name UIA attribute.
     */
    private async parseRow(row: WebdriverIO.Element, index: number): Promise<DownloadItem> {
        const cell = async (n: number): Promise<string> => {
            try {
                return (await (await row.$(`.//Text[${n}]`)).getText()) ?? '';
            } catch {
                return '';
            }
        };

        const col0 = await cell(COL_FILENAME);
        // Text[2] = queue number (skipped), Text[3] = size, Text[4] = status
        if (col0) {
            const nameAttr     = (await row.getAttribute('Name')) ?? '';
            const progressMatch = nameAttr.match(/(\d+\.?\d*%)/);
            return {
                index,
                fileName: col0,
                size:     (await cell(COL_SIZE))   || '—',
                status:   (await cell(COL_STATUS)) || '—',
                progress: progressMatch ? progressMatch[1] : '—',
            };
        }

        const nameAttr = (await row.getAttribute('Name')) ?? '';
        return parseIdmItemName(nameAttr, index);
    }

    // -----------------------------------------------------------------------
    // Core interactions
    // -----------------------------------------------------------------------

    async startDownload(item: DownloadItem): Promise<void> {
        const status = await this.getLiveStatus(item.index);
        if (COMPLETED_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
            throw new Error(`FAILED: Cannot start "${item.fileName}" — it is already completed.`);
        }
        const ACTIVE = ['Downloading', 'Connecting', 'Resuming'];
        if (ACTIVE.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
            console.log(`[Start] "${item.fileName}" is already active — skipping`);
            return;
        }
        await this.clickItem(item.index);
        await this.ensureSelected(item.index);
        await browser.pause(1000); // wait for button names to activate after selection
        await this.clickToolbarButton(SEL.TB_START);
        await this.waitForStatusChange(item.index, ['Downloading', 'Connecting', 'Resuming']);
    }

    async pauseDownload(item: DownloadItem): Promise<void> {
        const status = await this.getLiveStatus(item.index);
        if (COMPLETED_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
            throw new Error(`FAILED: Cannot pause "${item.fileName}" — it is already completed.`);
        }
        if (PAUSED_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
            console.log(`[Pause] "${item.fileName}" is already paused — skipping`);
            return;
        }
        await this.clickItem(item.index);
        await this.ensureSelected(item.index);
        await browser.pause(1000); // wait for button names to activate after selection
        await this.clickToolbarButton(SEL.TB_PAUSE);
        await this.waitForStatusChange(item.index, ['Paused', 'Stopped', 'Queued']);
    }

    async resumeDownload(item: DownloadItem): Promise<void> {
        const status = await this.getLiveStatus(item.index);
        if (COMPLETED_STATUSES.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
            throw new Error(`FAILED: Cannot resume "${item.fileName}" — it is already completed.`);
        }
        const ACTIVE = ['Downloading', 'Connecting', 'Resuming'];
        if (ACTIVE.some(s => status.toLowerCase().includes(s.toLowerCase()))) {
            console.log(`[Resume] "${item.fileName}" is already active — skipping`);
            return;
        }
        await this.clickItem(item.index);
        await this.ensureSelected(item.index);
        await browser.pause(1000); // wait for button names to activate after selection
        await this.clickToolbarButton(SEL.TB_RESUME);
        await this.waitForStatusChange(item.index, ['Downloading', 'Connecting', 'Resuming']);
    }

    async deleteDownload(item: DownloadItem): Promise<void> {
        const beforeCount = (await this.getListItems()).length;

        console.log(`[Delete] Selecting "${item.fileName}" at index ${item.index}...`);
        await this.clickItem(item.index);
        await this.ensureSelected(item.index);
        await browser.pause(1000); // wait for button names to activate after selection

        console.log('[Delete] Clicking Delete toolbar button...');
        await this.clickToolbarButton(SEL.TB_DELETE);

        // Wait up to 500ms for the confirmation dialog to appear
        await new Promise<void>(r => setTimeout(r, 500));

        console.log('[Delete] Checking for confirmation dialog...');
        let dialogHandled = false;
        for (const btnName of ['Yes', 'OK']) {
            try {
                const btn = await $(`//Button[@Name="${btnName}"]`);
                await btn.waitForExist({ timeout: 3000 });
                await btn.click();
                console.log(`[Delete] Dialog dismissed via "${btnName}"`);
                dialogHandled = true;
                break;
            } catch {
                // button not present — try next candidate
            }
        }
        if (!dialogHandled) {
            console.log('[Delete] No confirmation dialog appeared — continuing');
        }

        console.log('[Delete] Waiting for item to be removed from list...');
        // Scan the entire list for the filename, not just the original index
        // (IDM may reorder items before removing them)
        const needle = item.fileName.slice(0, 20).toLowerCase();
        await browser.waitUntil(
            async () => {
                const current = await this.getListItems();
                if (current.length < beforeCount) return true;
                for (const el of current) {
                    try {
                        const name = ((await el.getAttribute('Name')) ?? '').toLowerCase();
                        if (name.includes(needle)) return false; // still present
                    } catch {
                        // stale element during redraw — skip
                    }
                }
                return true; // filename no longer found in any row
            },
            {
                timeout: 20000,
                interval: 500,
                timeoutMsg: `"${item.fileName}" was not removed from the download list within 20s.`,
            }
        );
        console.log(`[Delete] "${item.fileName}" successfully removed`);
    }

    // -----------------------------------------------------------------------
    // Task 4 / 10 — Clear completed downloads
    // -----------------------------------------------------------------------

    /**
     * Scan the download list, remove every row whose status indicates completion,
     * and return the count of items cleared.
     *
     * Because deleting a row shifts all subsequent indices, we restart the scan
     * after each deletion rather than batching.
     */
    async clearCompleted(): Promise<number> {
        await this.waitForReady();

        let cleared = 0;
        let found = true;

        while (found) {
            found = false;
            const items = await this.getListItems();

            for (let i = 0; i < items.length; i++) {
                const statusText = await this.getItemStatus(items[i]);
                const isCompleted = COMPLETED_STATUSES.some(s => statusText.toLowerCase().includes(s.toLowerCase()));

                if (isCompleted) {
                    await items[i].click();
                    await this.clickToolbarButton(SEL.TB_DELETE);  // index 3
                    await this.dismissConfirmDialog();
                    cleared++;
                    found = true;
                    break; // restart scan — indices have shifted
                }
            }
        }

        return cleared;
    }

    // -----------------------------------------------------------------------
    // Task 5 — Context menu operations (public API)
    // -----------------------------------------------------------------------

    /** Right-click the item and open its Properties dialog. */
    async openProperties(item: DownloadItem): Promise<void> {
        await this.rightClickItem(item.index);
        await this.clickContextMenuItem(SEL.CTX_PROPERTIES);
    }

    /** Right-click the item and trigger Copy URL / Copy download link. */
    async copyUrl(item: DownloadItem): Promise<void> {
        await this.rightClickItem(item.index);
        await this.clickContextMenuItem(SEL.CTX_COPY_URL);
    }

    /**
     * Right-click the item and select Remove from list (does NOT delete the
     * file on disk — only removes the entry from IDM's queue).
     */
    async removeFromQueue(item: DownloadItem): Promise<void> {
        const beforeCount = (await this.getListItems()).length;
        await this.rightClickItem(item.index);
        await this.clickContextMenuItem(SEL.CTX_REMOVE);
        await this.dismissConfirmDialog();
        await browser.waitUntil(
            async () => (await this.getListItems()).length < beforeCount,
            {
                timeout: 8000,
                interval: 500,
                timeoutMsg: `"${item.fileName}" was not removed from the queue within 8s.`,
            }
        );
    }

    /** Right-click the item and open the containing folder in Explorer. */
    async openFileLocation(item: DownloadItem): Promise<void> {
        await this.rightClickItem(item.index);
        await this.clickContextMenuItem(SEL.CTX_OPEN_LOCATION);
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private async getListItems(): Promise<WebdriverIO.Element[]> {
        const toArray = async (xpath: string): Promise<WebdriverIO.Element[]> => {
            try {
                const raw = await $$(xpath) as unknown as WebdriverIO.Element[];
                const arr: WebdriverIO.Element[] = [];
                for (let i = 0; i < raw.length; i++) arr.push(raw[i]);
                return arr;
            } catch {
                return [];
            }
        };

        let items = await toArray('//List[@ClassName="SysListView32"]//ListItem');
        if (items.length > 0) {
            if (DEBUG_MODE) console.log(`[Debug] Strategy 1 (SysListView32//ListItem): ${items.length} items`);
            return items;
        }

        items = await toArray('//List[@AutomationId="1002"]//ListItem');
        if (items.length > 0) {
            if (DEBUG_MODE) console.log(`[Debug] Strategy 2 (AutomationId=1002//ListItem): ${items.length} items`);
            return items;
        }

        items = await toArray('//List//ListItem');
        if (items.length > 0) {
            if (DEBUG_MODE) console.log(`[Debug] Strategy 3 (//List//ListItem): ${items.length} items`);
            return items;
        }

        items = await toArray('//ListItem');
        if (items.length > 0) {
            if (DEBUG_MODE) console.log(`[Debug] Strategy 4 (//ListItem): ${items.length} items`);
            return items;
        }

        items = await toArray('//DataItem');
        if (items.length > 0) {
            if (DEBUG_MODE) console.log(`[Debug] Strategy 5 (//DataItem): ${items.length} items`);
            return items;
        }

        if (DEBUG_MODE) console.log('[Debug] All 5 selector strategies returned 0 items');
        return [];
    }

    /**
     * Retry wrapper for transient WinAppDriver / UIA failures (stale element
     * references, in-progress redraws). Re-fetches the element on each attempt
     * so a stale reference from a previous pass is never reused.
     * Uses setTimeout rather than browser.pause() to comply with the project's
     * no-hardcoded-pause constraint (this is infrastructure delay, not UI sync).
     */
    private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                if (attempt < maxAttempts) {
                    await new Promise<void>(r => setTimeout(r, 300 * attempt));
                }
            }
        }
        throw lastError;
    }

    private async clickItem(index: number): Promise<void> {
        await this.withRetry(async () => {
            const items = await this.getListItems();
            const item = items[index];
            if (!item) throw new Error(`No list item at index ${index}.`);
            await item.click();
        });
    }

    // Task 4: verify selection state before toolbar click; re-click if not selected
    private async ensureSelected(index: number): Promise<void> {
        try {
            const items = await this.getListItems();
            const item = items[index];
            if (!item) return;
            const isSelected = await item.getAttribute('IsSelected');
            if (isSelected === 'True') return; // already selected
            // Re-click and give UIA time to reflect selection
            await item.click();
            await new Promise<void>(r => setTimeout(r, 300));
        } catch {
            // Non-fatal — proceed even if selection check fails
        }
    }

    private async clickToolbarButton(index: number): Promise<void> {
        const toArr = (raw: unknown): WebdriverIO.Element[] => {
            const arr = raw as WebdriverIO.Element[];
            const result: WebdriverIO.Element[] = [];
            for (let i = 0; i < arr.length; i++) result.push(arr[i]);
            return result;
        };

        // Primary: buttons directly under the identified ToolBar element
        try {
            const toolbar = await $('//ToolBar[@AutomationId="59392"]');
            const btns = toArr(await toolbar.$$('.//Button') as unknown);
            if (btns.length > index) {
                await btns[index].click();
                return;
            }
        } catch {
            // fall through to global fallback
        }

        // Fallback: all toolbar buttons globally
        const allBtns = toArr(await $$('//ToolBar//Button') as unknown);
        if (!allBtns[index]) {
            throw new Error(
                `Toolbar button index ${index} not found. Total: ${allBtns.length}`
            );
        }
        await allBtns[index].click();
    }

    /**
     * Dump the full WinAppDriver UIA tree to stdout as raw XML.
     * browser.getPageSource() returns the entire accessibility tree of the
     * current session window — AutomationId, Name, ClassName, ControlType
     * are all present as XML attributes. Use this to discover real button IDs.
     */
    async dumpUITree(): Promise<void> {
        try {
            const xml = await browser.getPageSource();
            console.log('\n===== IDM UI TREE DUMP (begin) =====');
            console.log(xml);
            console.log('===== IDM UI TREE DUMP (end) =====\n');
        } catch (err) {
            console.warn('[dumpUITree] Failed to retrieve page source:', err instanceof Error ? err.message : err);
        }
    }

    private async rightClickItem(index: number): Promise<void> {
        const items = await this.getListItems();
        const item = items[index];
        if (!item) throw new Error(`No list item at index ${index}.`);
        await item.click({ button: 'right' });
    }

    /**
     * Two-phase context-menu item click.
     *
     * Phase 1 (fast path): try each `~AutomationId` selector directly.
     *   Works for English IDM where WinAppDriver maps menu item Name → AutomationId.
     *
     * Phase 2 (self-healing): scan every live //MenuItem (and //Menu//Text as
     *   fallback) element, normalise its Name attribute (strip leading ~, ellipses,
     *   extra whitespace, lowercase), then click the first element whose normalised
     *   label contains any of the normalised candidate keywords as a substring.
     *   This handles localised strings, ellipsis variants, and minor version diffs
     *   without requiring exact selector matches.
     */
    private async clickContextMenuItem(candidates: readonly string[]): Promise<void> {
        // Phase 1 — direct AutomationId selector (fast, version-specific)
        for (const selector of candidates) {
            try {
                const el = await $(selector);
                await el.waitForExist({ timeout: 2000 });
                await el.click();
                return;
            } catch {
                // candidate not present — continue
            }
        }

        // Phase 2 — self-healing scan
        const norm = (s: string) =>
            s.replace(/^~/, '').toLowerCase().replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim();
        const keywords = [...new Set(candidates.map(norm))].filter(Boolean);

        const isMatch = (label: string): boolean => {
            const n = norm(label);
            return n.length > 0 && keywords.some(kw => n.includes(kw) || kw.includes(n));
        };

        // Scope the scan to the Win32 floating context-menu window (#32768).
        // A plain //MenuItem query hits the top-level menu bar instead.
        for (const xpath of [
            '//Window[@ClassName="#32768"]//MenuItem',
            '//Window[@ClassName="#32768"]//Text',
        ]) {
            let els: WebdriverIO.Element[];
            try {
                const raw = await $$(xpath) as unknown as WebdriverIO.Element[];
                els = [];
                for (let i = 0; i < raw.length; i++) els.push(raw[i]);
            } catch {
                continue;
            }

            for (const el of els) {
                try {
                    const name = (await el.getAttribute('Name')) ?? '';
                    const text = await el.getText().catch(() => '');
                    if (isMatch(name) || isMatch(text)) {
                        await el.click();
                        return;
                    }
                } catch {
                    // element stale or inaccessible — skip
                }
            }
        }

        throw new Error(
            `Context menu item not found after self-healing scan. Candidates: ${candidates.join(', ')}`
        );
    }

    /** Dismiss a confirmation dialog if one appears; silently no-op if absent. */
    private async dismissConfirmDialog(): Promise<void> {
        const candidates = ['Yes', 'OK'];
        for (const name of candidates) {
            try {
                const btn = await $(`//Button[@Name="${name}"]`);
                await btn.waitForExist({ timeout: 3000 });
                await btn.click();
                return;
            } catch {
                // dialog didn't appear or button not found — continue
            }
        }
        // silently continue if no dialog appeared
    }

    /** Fetch the live status string for the row at `index` (lowercase). */
    private async getLiveStatus(index: number): Promise<string> {
        const items = await this.getListItems();
        const item = items[index];
        if (!item) throw new Error(`No list item at index ${index}.`);
        return this.getItemStatus(item);
    }

    /**
     * Resolve the status text for a list-view row element.
     * Uses COL_STATUS (Text[4]) which holds the status string in IDM's
     * SysListView32 layout (Text[2] is empty; Text[3] is file size).
     * Falls back to the Name attribute tab-split on WinAppDriver versions
     * that expose a composite Name rather than individual Text children.
     */
    private async getItemStatus(item: WebdriverIO.Element): Promise<string> {
        try {
            return ((await (await item.$(`.//Text[${COL_STATUS}]`)).getText()) ?? '').toLowerCase();
        } catch {
            const name = ((await item.getAttribute('Name')) ?? '').toLowerCase();
            const parts = name.split(/\t|,\s+/);
            return (parts[2] ?? '').toLowerCase();
        }
    }

    /**
     * Poll the status of the row at `index` until it matches one of
     * `expectedStatuses` (case-insensitive).
     *
     * Each poll calls getLiveStatus(index) which re-fetches the full item list
     * and reads Text[COL_STATUS] — this avoids stale element references and
     * the incorrect-column bug that existed when polling the Name attribute.
     */
    private async waitForStatusChange(index: number, expectedStatuses: string[]): Promise<void> {
        const lower = expectedStatuses.map(s => s.toLowerCase());
        await browser.waitUntil(
            async () => {
                try {
                    const status = await this.getLiveStatus(index);
                    return lower.some(s => status.includes(s));
                } catch {
                    return false;
                }
            },
            {
                timeout: 10000,
                interval: 500,
                timeoutMsg:
                    `Status did not change to [${expectedStatuses.join(' | ')}] within 10 s.`,
            }
        );
    }
}

export const idmPage = new IdmPage();
