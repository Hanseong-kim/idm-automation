import type { DownloadItem } from '../../src/agent/types';

// ---------------------------------------------------------------------------
// Selectors
// IDM is a Win32 app. WinAppDriver exposes UIA properties via XPath.
// Use Windows Inspect.exe (SDK tool) or Accessibility Insights to verify/tune
// these selectors against your installed IDM version.
// ---------------------------------------------------------------------------
const SEL = {
    // Download list — Win32 SysListView32 → UIA List control
    // Note: '~name' in WinAppDriver maps to UIA AutomationId, NOT Name/title.
    // Use XPath @Name for title-based lookup; use browser.getTitle() for the session root window.
    DOWNLOAD_LIST: '//List[@ClassName="SysListView32"]',

    // Each download row inside the list (relative XPath — prefixed with .// in usage)
    LIST_ITEM: './/ListItem',

    // Toolbar button indices (0-based) within //ToolBar//Button, confirmed from
    // screenshot: 추가(0) 시작(1) 중지(2) 모두중지(3) 제거(4) 모두제거(5)
    //             환경설정(6) 예약작업(7) 전송시작(8) 전송중지(9) 소개하기(10)
    TB_START:  1,   // 시작 — resume/start selected download
    TB_PAUSE:  2,   // 중지 — pause/stop selected download
    TB_DELETE: 4,   // 제거 — delete/remove selected download

    // Context-menu items — retained for Task 5 supplementary operations.
    CTX_START:  ['~Start', '~Start (Resume)', '~Continue', '~Download'] as const,
    CTX_PAUSE:  ['~Stop', '~Pause', '~Stop (Pause)', '~Pause/Stop']    as const,
    CTX_RESUME: ['~Start', '~Start (Resume)', '~Continue', '~Resume']  as const,
    CTX_DELETE: ['~Delete', '~Delete...', '~Remove', '~Remove...', '~삭제', '~삭제...', '~제거'] as const,

    // Task 5 — additional context-menu actions
    CTX_PROPERTIES:    ['~Properties', '~속성']                                                as const,
    CTX_COPY_URL:      ['~Copy download link', '~Copy URL', '~링크 복사', '~URL 복사']         as const,
    CTX_REMOVE:        ['~Remove from list', '~Remove', '~목록에서 제거', '~대기열에서 제거']   as const,
    CTX_OPEN_LOCATION: ['~Open file location', '~Open folder', '~파일 위치 열기', '~폴더 열기'] as const,

} as const;

// Status strings that indicate a completed download (English and Korean)
const COMPLETED_STATUSES = ['완료', 'complete', 'done', 'finished', '100%'];

// Status strings that indicate a download is already paused/stopped
const PAUSED_STATUSES = ['paused', 'stopped', 'queued', 'scheduled', '일시정지', '중지', '대기', '일시 정지', '중지됨'];

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
        // browser.getTitle() returns the UIA Name of the session root window.
        // This is more reliable than findElement, which maps '~x' to AutomationId (not Name).
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
        const rows = await this.getListItems();
        const result: DownloadItem[] = [];

        for (let i = 0; i < rows.length; i++) {
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
        if (col0) {
            return {
                index,
                fileName: col0,
                size:     (await cell(COL_SIZE))   || '—',
                status:   (await cell(COL_STATUS)) || '—',
                progress: '—',
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
        if (COMPLETED_STATUSES.some(s => status.includes(s))) {
            throw new Error(`FAILED: Cannot start "${item.fileName}" — it is already completed.`);
        }
        await this.clickItem(item.index);
        await this.clickToolbarButton(SEL.TB_START);
        await this.waitForStatusChange(item.index, [
            'Downloading', 'Connecting', 'In progress',
            '다운로드 중', '연결 중',
        ]);
    }

    async pauseDownload(item: DownloadItem): Promise<void> {
        const status = await this.getLiveStatus(item.index);
        if (COMPLETED_STATUSES.some(s => status.includes(s))) {
            throw new Error(`FAILED: Cannot pause "${item.fileName}" — it is already completed.`);
        }
        if (PAUSED_STATUSES.some(s => status.includes(s))) {
            throw new Error(`FAILED: Cannot pause "${item.fileName}" — it is already paused/stopped.`);
        }
        await this.clickItem(item.index);
        await this.clickToolbarButton(SEL.TB_PAUSE);
        await this.waitForStatusChange(item.index, [
            'Paused', 'Stopped', 'Queued',
            '일시정지', '중지', '대기', '일시 정지', '중지됨',
        ]);
    }

    async resumeDownload(item: DownloadItem): Promise<void> {
        const status = await this.getLiveStatus(item.index);
        if (COMPLETED_STATUSES.some(s => status.includes(s))) {
            throw new Error(`FAILED: Cannot resume "${item.fileName}" — it is already completed.`);
        }
        await this.clickItem(item.index);
        await this.clickToolbarButton(SEL.TB_START);
        await this.waitForStatusChange(item.index, [
            'Downloading', 'Connecting', 'Resuming',
            '다운로드 중', '연결 중', '재시작',
        ]);
    }

    async deleteDownload(item: DownloadItem): Promise<void> {
        const beforeCount = (await this.getListItems()).length;

        await this.clickItem(item.index);
        await this.clickToolbarButton(SEL.TB_DELETE);
        await this.dismissConfirmDialog();

        // Accept either a count drop OR the file name no longer appearing at
        // the same index (IDM sometimes relocates cancelled items before hiding them).
        const needle = item.fileName.slice(0, 15).toLowerCase();
        await browser.waitUntil(
            async () => {
                const items = await this.getListItems();
                if (items.length < beforeCount) return true;
                if (items[item.index]) {
                    const name = ((await items[item.index].getAttribute('Name')) ?? '').toLowerCase();
                    if (!name.includes(needle)) return true;
                }
                return false;
            },
            {
                timeout: 15000,
                interval: 500,
                timeoutMsg: `"${item.fileName}" was not removed from the download list within 15s.`,
            }
        );
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
                const isCompleted = COMPLETED_STATUSES.some(s => statusText.includes(s));

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
        // Use the global $$ with a combined absolute XPath instead of chaining
        // element.$$ — chained $$ in WDIO v9 returns a ChainablePromiseArray that
        // is not a plain JS array and breaks index access in some contexts.
        const all = await $$('//List[@ClassName="SysListView32"]//ListItem') as unknown as WebdriverIO.Element[];
        const result: WebdriverIO.Element[] = [];
        for (let i = 0; i < all.length; i++) {
            result.push(all[i]);
        }
        return result;
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

    /**
     * Click a toolbar button by its 0-based index within the toolbar's direct
     * interactive children (Button and SplitButton).
     * Using a union XPath ensures SplitButton elements are included in the
     * array, keeping buttons[index] aligned with the visual toolbar order.
     * Indices confirmed from UI tree dump:
     *   1=시작, 2=중지, 4=제거
     */
    private async clickToolbarButton(index: number): Promise<void> {
        await this.withRetry(async () => {
            const buttons = await $$('//ToolBar/*[self::Button or self::SplitButton]');
            const btn = buttons[index];
            if (!btn) {
                throw new Error(
                    `Toolbar button at index ${index} not found — only ${buttons.length} button(s) in toolbar.`
                );
            }
            await btn.click();
        });
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
        const candidates = ['예', '확인', 'Yes', 'OK'];
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
