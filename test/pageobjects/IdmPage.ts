import * as fs from 'fs';
import * as path from 'path';
import type { DownloadItem } from '../../src/agent/types';


const DEBUG_MODE = process.env['DEBUG_MODE'] === 'true';

const SEL = {
    DOWNLOAD_LIST: '//List[@ClassName="SysListView32"]',
    LIST_ITEM:     './/ListItem',
    
    TB_ADD_URL: 0,
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

// ---------------------------------------------------------------------------
// IDM Dialog Identification Map
// IDM uses Win32 ClassName="#32770" for EVERY popup: URL input, File Info,
// error/warning, confirmation, etc. Window class and title alone cannot
// distinguish them. We identify each dialog by the distinctive UI element it
// contains. Use these selectors as "dialog type probes" instead of bare #32770.
// ---------------------------------------------------------------------------
const IDM_DIALOG = {
    BASE:      '//Window[@ClassName="#32770"]',
    // URL Input dialog  → probe: has an Edit textbox (the URL entry field)
    URL_EDIT:  '//Window[@ClassName="#32770"]//Edit',
    // File Info dialog  → identified via findStartButtonInDialog() (keyword scan).
    //   Exact @Name probes fail due to locale variants, shortcut chars (&), and IDM version diffs.
} as const;

const COMPLETED_STATUSES = ['Complete', 'Completed', 'Done', 'Finished', '100%'];
const PAUSED_STATUSES    = ['Paused', 'Stopped', 'Queued', 'Scheduled'];

// SysListView32 column indices (1-based XPath Text[N]).
// 실측 확정 (IDM 6.42): Text[1]=파일명, Text[2]=(빈칸), Text[3]=파일크기,
//   Text[4]=진행률(%) — 상태어("Downloading"/"Paused")가 아닌 퍼센트,
//   Text[5]=남은시간, Text[6]=전송속도 (멈추면 빈 문자열).
// pause/resume 판정은 Text[4] 문자열이 아니라 Text[6] 전송속도 유무로 한다.
const COL_FILENAME = 1;
const COL_SIZE     = 3;
const COL_STATUS   = 4;   // 진행률(%) — getLiveStatus의 "100%" completed 판정에만 유효
// COL_TIMELEFT = 5        // 남은 시간 (현재 미사용, 참고용)
const COL_SPEED    = 6;   // 전송 속도 — pause/resume 판정의 핵심

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
        await this.waitForTransferState(item.index, true);
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
        await this.waitForTransferState(item.index, false);
        
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
        await this.waitForTransferState(item.index, true);
        
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

        await this.dismissConfirmDialog();
        
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
            const countBefore = items.length;

            for (let i = 0; i < items.length; i++) {
                const statusText = await this.getItemStatus(items[i]);
                const isCompleted = COMPLETED_STATUSES.some(s => statusText.toLowerCase().includes(s.toLowerCase()));

                if (isCompleted) {
                    await items[i].click();
                    await this.clickToolbarButton(SEL.TB_DELETE);
                    
                    // 1. 팝업이 뜰 시간을 보장 (500ms 대기)
                    await new Promise<void>(r => setTimeout(r, 500));
                    await this.dismissConfirmDialog();
                    
                    // 2. 실제로 항목이 리스트에서 제거될 때까지 최대 10초간 동기화 대기
                    await browser.waitUntil(
                        async () => (await this.getListItems()).length < countBefore,
                        { 
                            timeout: 10000, 
                            interval: 500,
                            timeoutMsg: 'Item was not removed from the list in time.'
                        }
                    );
                    
                    cleared++;
                    found = true;
                    break; // 인덱스 변화가 생기므로 루프 재시작
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
        const btns = await $$('//ToolBar//Button');
        if (!btns[index]) throw new Error('Button index ' + index + ' not found. Total: ' + btns.length);
        await btns[index].click();
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
        // 1. 팝업창(#32770) 자체가 화면에 존재하는지 먼저 1초만 빠르고 짧게 확인합니다.
        const dialog = await $('//Window[@ClassName="#32770"]');
        try {
            await dialog.waitForExist({ timeout: 1000 });
        } catch {
            // 팝업창이 안 떴다면 허공에 대고 6초씩 버튼을 찾을 필요가 없습니다! 즉시 종료.
            return; 
        }

        // 2. 팝업이 확실히 있다면, 그 안에서 Yes, OK, 예, 확인 중 하나를 눌러 닫습니다.
        const candidates = ['Yes', 'OK'];
        for (const name of candidates) {
            try {
                const btn = await dialog.$(`.//Button[@Name="${name}"]`);
                if (await btn.isExisting()) {
                    await btn.click();
                    await browser.pause(500); // 닫히는 애니메이션 대기
                    return;
                }
            } catch { /* 다음 버튼 시도 */ }
        }
    }

    /** Fetch the live status string for the row at `index` (lowercase). */
    private async getLiveStatus(index: number): Promise<string> {
        const items = await this.getListItems();
        const item = items[index];
        if (!item) throw new Error(`No list item at index ${index}.`);
        return this.getItemStatus(item);
    }

    /**
     * Resolve the progress/status text for a list-view row element (Text[COL_STATUS]).
     * IDM 6.42 실측: Text[4]는 진행률(%)만 표시 — "100%"로 completed 판정에 사용.
     * pause/resume 상태 판정은 isTransferring(Text[COL_SPEED])으로 별도 수행.
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
     * 행이 현재 활성 전송 중인지(전송 속도 > 0) 판정.
     * IDM 6.42 실측: Text[COL_SPEED](Text[6])에 "36.53 MB/sec" 형태로 표시,
     * 멈추면 빈 문자열 또는 "0 B/sec".
     */
    private async isTransferring(index: number): Promise<boolean> {
        const items = await this.getListItems();
        const item = items[index];
        if (!item) return false;
        const speed = (await (await item.$(`.//Text[${COL_SPEED}]`)).getText().catch(() => '')) ?? '';
        const s = speed.trim().toLowerCase();
        if (!s) return false;
        const num = parseFloat(s.replace(/[^0-9.]/g, ''));
        return num > 0;
    }

    /** 전송 속도가 기대 상태(활성/비활성)가 될 때까지 폴링. */
    private async waitForTransferState(index: number, expectActive: boolean, timeoutMs = 10000): Promise<void> {
        await browser.waitUntil(
            async () => {
                try {
                    return (await this.isTransferring(index)) === expectActive;
                } catch {
                    return false;
                }
            },
            {
                timeout: timeoutMs,
                interval: 500,
                timeoutMsg: `Transfer did not become ${expectActive ? 'active' : 'inactive'} within ${timeoutMs / 1000}s.`,
            }
        );
    }

    async addUrlDownload(url: string): Promise<{ wasDuplicate: boolean }> {
        await this.waitForReady();
        const { execSync } = await import('child_process');

        // 1. Click "Add URL" toolbar button (index 0)
        console.log('[addUrlDownload] Clicking "Add URL" button...');
        await this.clickToolbarButton(SEL.TB_ADD_URL);

        // 2. Wait for URL input dialog (Edit field) to appear
        console.log('[addUrlDownload] Waiting for URL input dialog...');
        await $(IDM_DIALOG.URL_EDIT).waitForExist({ timeout: 5000 });
        console.log('[addUrlDownload] URL input dialog appeared.');

        // 3. Set clipboard with URL
        console.log('[addUrlDownload] Setting clipboard...');
        execSync(`powershell -command "Set-Clipboard -Value '${url}'"`, { windowsHide: true });

        // 4. Force focus to #32770 dialog via SetForegroundWindow, then paste
        //    SendKeys loses focus when spawned without a parent window — SetForegroundWindow
        //    pins the dialog to the foreground before sending ^a^v so the paste lands correctly.
        console.log('[addUrlDownload] Focusing dialog via SetForegroundWindow and pasting...');
        const psScript = [
            'Add-Type @"',
            'using System;',
            'using System.Runtime.InteropServices;',
            'public class Win32 {',
            '    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string a, string b);',
            '    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);',
            '}',
            '"@',
            '$hwnd = [Win32]::FindWindow("#32770", $null)',
            '[Win32]::SetForegroundWindow($hwnd)',
            'Start-Sleep -Milliseconds 300',
            'Add-Type -AssemblyName System.Windows.Forms',
            '[System.Windows.Forms.SendKeys]::SendWait("^a^v")',
        ].join('\n');
        const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
        execSync(`powershell -NonInteractive -EncodedCommand ${encoded}`, { windowsHide: true });

        // 5. Wait for paste to settle before clicking OK
        await browser.pause(500);

        // 6. Click OK
        console.log('[addUrlDownload] Clicking OK button...');
        const okBtn = $(IDM_DIALOG.BASE).$('.//Button[@Name="OK" or @Name="확인"]');
        await okBtn.waitForExist({ timeout: 3000 });
        await okBtn.click();
        console.log('[addUrlDownload] OK clicked.');

        // 7. OK 클릭 이후: 중복 경고 팝업 처리 + URL 다이얼로그 닫힘 대기 (최대 8초)
        console.log('[addUrlDownload] Waiting for URL dialog to close...');

        let urlDialogClosed = false;
        let wasDuplicate = false;
        const dlDeadline = Date.now() + 8_000;

        while (!urlDialogClosed && Date.now() < dlDeadline) {
            // 1. 중복 팝업 처리 — 아직 처리 안 됐을 때만 시도
            if (!wasDuplicate) {
                wasDuplicate = await this.handleDuplicateDialog();
            }

            // 2. URL 입력창 닫힘 확인 (Edit 필드 사라짐)
            try {
                if (!(await $(IDM_DIALOG.URL_EDIT).isExisting())) { urlDialogClosed = true; break; }
            } catch {
                urlDialogClosed = true; break;
            }

            await new Promise<void>(r => setTimeout(r, 300));
        }

        if (!urlDialogClosed) {
            // self-healing 폴백: LLM이 팝업 처리 시도
            console.warn('[addUrlDownload] URL dialog still open after 8s — attempting self-healing...');
            const healed = await this.handleUnexpectedDialog('add and start the download');
            if (!healed) {
                throw new Error('[addUrlDownload] URL dialog did not close (and no known dialog handled).');
            }
        }
        console.log('[addUrlDownload] URL dialog closed.');

        // 8. 중복이면 Start Download 단계 건너뜀 — "Download complete" 창 등은 무시
        if (wasDuplicate) {
            console.log('[addUrlDownload] Duplicate handled — skipping Start Download step.');
            return { wasDuplicate: true };
        }

        // 8. File Info ClassName 무관하게 트리 전체에서 "Start Download" 버튼을 찾아 클릭
        console.log('[addUrlDownload] Waiting for "Start Download" button...');
        try {
            await this.waitAndClickStartDownload();
            console.log('[addUrlDownload] "Start Download" clicked successfully.');
        } catch (e) {
            console.warn('[addUrlDownload] "Start Download" not clicked:', e instanceof Error ? e.message : e);
        }
        return { wasDuplicate: false };
    }


    /**
     * IDM File Info 창의 ClassName에 의존하지 않고 트리 전체에서
     * "Start Download" 버튼을 폴링으로 찾아 클릭한다.
     *
     * - 최대 12초 / 400ms 간격으로 폴링
     * - 현재 컨텍스트 스캔 → 실패 시 다른 window handle 전환 후 재스캔
     * - STRICT 복합 키워드만 사용 (bare "start"/"시작" 금지: 툴바 오매칭 방지)
     */

    /**
     * 중복 다운로드 경고("Duplicate download link") 팝업이 떠 있으면 OK를 눌러
     * IDM 기본 동작(기존 설정대로 진행)으로 처리한다. 처리했으면 true.
     *
     * 단수 $()는 첫 번째 #32770(메인 창)을 잡아 SysListView 검사 후 null을 반환하므로
     * 두 번째로 뜬 중복 팝업에 도달하지 못한다 — $$()로 전수 검사한다.
     */
    private async handleDuplicateDialog(): Promise<boolean> {
        const wins = await $$('//Window[@ClassName="#32770"]') as unknown as WebdriverIO.Element[];
        for (let i = 0; i < wins.length; i++) {
            const win = wins[i];
            const winName = ((await win.getAttribute('Name').catch(() => '')) ?? '').toLowerCase();

            // 1차: 제목으로 식별
            let isDup = winName.includes('duplicate');

            // 2차: 제목 매칭 실패 시 본문 텍스트로 식별
            if (!isDup) {
                const texts = await win.$$('.//Text') as unknown as WebdriverIO.Element[];
                for (let t = 0; t < texts.length; t++) {
                    const tx = ((await texts[t].getText().catch(() => '')) ?? '').toLowerCase();
                    if (tx.includes('already exists') || tx.includes('duplicate') || tx.includes('이미')) {
                        isDup = true;
                        break;
                    }
                }
            }
            if (!isDup) continue;

            // 중복 팝업 확정 — OK 클릭 (Name="OK" 확정, 정규화 부분일치로 안전하게)
            const btns = await win.$$('.//Button') as unknown as WebdriverIO.Element[];
            for (let b = 0; b < btns.length; b++) {
                const bn = ((await btns[b].getAttribute('Name').catch(() => '')) ?? '').trim().toLowerCase();
                if (['cancel', '취소', '최소화', '최대화', '닫기', 'x'].includes(bn)) continue;
                if (bn === 'ok' || bn === '확인') {
                    console.log('[addUrlDownload] Duplicate dialog detected → clicking OK to proceed.');
                    await btns[b].click();
                    return true;
                }
            }
        }
        return false;
    }

    private async waitAndClickStartDownload(): Promise<void> {
        const START_KEYWORDS = ['startdownload', '다운로드시작', '지금다운로드', 'downloadnow'];
        const AVOID_KEYWORDS = ['later', '나중', 'cancel', '취소'];

        const norm = (s: string): string =>
            s.replace(/&/g, '')
             .replace(/\(.*?\)/g, '')
             .toLowerCase()
             .replace(/\s+/g, '')
             .trim();

        const isStart = (name: string): boolean => {
            const n = norm(name);
            if (!n) return false;
            if (AVOID_KEYWORDS.some(kw => n.includes(kw))) return false;
            return START_KEYWORDS.some(kw => n.includes(kw));
        };

        // 현재 컨텍스트의 //Button 전체를 스캔하여 매칭 버튼 반환
        const scanCurrentContext = async (): Promise<WebdriverIO.Element | null> => {
            try {
                const raw = await $$('//Button') as unknown as WebdriverIO.Element[];
                const btns: WebdriverIO.Element[] = [];
                for (let i = 0; i < raw.length; i++) btns.push(raw[i]);
                for (const btn of btns) {
                    try {
                        const name = (await btn.getAttribute('Name')) ?? '';
                        if (isStart(name)) return btn;
                    } catch {
                        // stale — skip
                    }
                }
            } catch {
                // 컨텍스트 접근 실패 — skip
            }
            return null;
        };

        const deadline = Date.now() + 12_000;
        const originalHandle = await browser.getWindowHandle();

        while (Date.now() < deadline) {
            // 1. 현재 핸들에서 스캔
            const found = await scanCurrentContext();
            if (found) {
                await found.click();
                return;
            }

            // 2. 다른 핸들 순회
            const handles = await browser.getWindowHandles();
            if (handles.length > 1) {
                for (const h of handles) {
                    if (h === originalHandle) continue;
                    try {
                        await browser.switchToWindow(h);
                        const btn = await scanCurrentContext();
                        if (btn) {
                            await btn.click();
                            return;
                        }
                    } catch {
                        // 접근 불가 핸들 — skip
                    } finally {
                        try { await browser.switchToWindow(originalHandle); } catch {}
                    }
                }
            }

            await new Promise<void>(r => setTimeout(r, 400));
        }

        // 폴백: UI 트리 덤프 → LLM 자가치유 → throw
        console.warn('[waitAndClickStartDownload] Button not found after 12s — falling back...');
        await this.dumpUITree();
        const healed = await this.handleUnexpectedDialog('add and start the download');
        if (!healed) {
            throw new Error(
                '[addUrlDownload] Could not find or click the "Start Download" button after 12s. ' +
                'Check fileinfo-tree.xml and the UI tree dump for actual button labels.'
            );
        }
    }

    // -----------------------------------------------------------------------
    // Bonus Feature: Self-Healing Automation (UI Tree OCR + LLM)
    // -----------------------------------------------------------------------
    //
    // ⚠️  IDM Dialog Domain Rule (read before modifying this method):
    //   IDM uses Win32 ClassName="#32770" for EVERY popup window — URL input,
    //   File Info, duplicate warning, error alert, confirmation, etc.
    //   You CANNOT distinguish dialogs by ClassName or window title alone.
    //   Always inspect the INTERNAL elements (buttons, text nodes, Edit fields)
    //   to infer the dialog's purpose before deciding which button to click.
    //   See IDM_DIALOG constants at the top of this file for the typed probes.
    //
    async handleUnexpectedDialog(intent: string): Promise<boolean> {
        console.log('[Self-Healing] Scanning for unexpected dialogs...');
        try {
            // 1. #32770 다이얼로그 확인 — SysListView32를 포함하면 메인 창이므로 제외
            //    한계: $()는 첫 번째 #32770만 잡는다. 메인 창(SysListView 포함)이 첫 번째이면
            //    null을 반환해 그 뒤에 뜬 팝업을 놓친다. 중복 다운로드 팝업처럼 두 번째 #32770이
            //    진짜 대화상자인 경우는 handleDuplicateDialog($$로 전수 검사)로 먼저 처리한다.
            const findValidDialog = async (): Promise<WebdriverIO.Element | null> => {
                try {
                    const win = $('//Window[@ClassName="#32770"]');
                    if (!(await win.isExisting())) return null;
                    const hasList = await win.$('.//List[@ClassName="SysListView32"]').isExisting().catch(() => false);
                    return hasList ? null : win as unknown as WebdriverIO.Element;
                } catch {
                    return null;
                }
            };

            let activeWindow: WebdriverIO.Element | null = null;
            try {
                await browser.waitUntil(
                    async () => {
                        activeWindow = await findValidDialog();
                        return activeWindow !== null;
                    },
                    { timeout: 1500, interval: 300, timeoutMsg: 'No valid dialog found.' }
                );
            } catch {
                return false;
            }

            if (!activeWindow) return false;
            // TypeScript CFA does not track async-callback mutations; cast to resolve 'never' inference
            const dialog = activeWindow as unknown as WebdriverIO.Element;

            // 2. 팝업창 내의 모든 텍스트(Text) 긁어오기
            const textElements = dialog.$$('.//Text');
            let dialogText = '';
            for (const el of textElements) {
                const text = await el.getText().catch(() => '');
                if (text) dialogText += text + ' ';
            }

            // 3. 팝업창 내의 버튼 이름 수집 (시스템 창 제어 버튼 제외)
            const BLOCKED_BUTTONS = ['최대화', '최소화', '닫기', 'x', 'Maximize', 'Minimize', 'Close', 'Restore', 'Help'];
            const buttonElements = dialog.$$('.//Button');
            const availableButtons: string[] = [];
            for (const el of buttonElements) {
                const name = await el.getAttribute('Name').catch(() => '');
                if (name && name.trim() !== '') {
                    const isBlocked = BLOCKED_BUTTONS.some(b => name.toLowerCase().trim() === b.toLowerCase());
                    if (!isBlocked) availableButtons.push(name);
                }
            }

            if (!dialogText.trim() || availableButtons.length === 0) {
                return false; // 읽을 텍스트나 버튼이 없으면 포기
            }

            console.log(`\n  [🤖 UI Scanner] Detected Dialog!`);
            console.log(`  - Message: "${dialogText.trim()}"`);
            console.log(`  - Buttons: [${availableButtons.join(', ')}]`);

            // 4. AI에게 프롬프트를 보내서 스스로 판단하게 함
            console.log('  [🤖 Agent Brain] Asking AI what to do...');
            const prompt = `
                            You are an intelligent RPA agent controlling Internet Download Manager.
                            The user's intent is: "${intent}".
                            An unexpected dialog just popped up.
                            Dialog message: "${dialogText.trim()}"
                            Available buttons you can click: [${availableButtons.join(', ')}]

                            Your task: Decide which button to click to fulfill the user's intent. 
                            
                            CRITICAL RULES:
                            1. NEVER choose window control buttons like '최소화' (Minimize), '최대화' (Maximize), '닫기' (Close), or 'x'.
                            2. Always prefer confirmation buttons like 'OK', 'Yes', '확인', '예' to proceed with the download.
                            
                            Respond STRICTLY in JSON format with a single key "target_button".
                            Example: { "target_button": "OK" }
                            `;

            // 로컬 Ollama API 호출 (JSON 포맷 강제)
            const resp = await fetch('http://localhost:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'qwen2:1.5b',
                    format: 'json',
                    messages: [{ role: 'user', content: prompt }],
                    stream: false
                })
            });

            const data = await resp.json();
            const decision = JSON.parse(data.message?.content || '{}');
            const targetButton = decision.target_button;

            // 5. LLM이 선택한 버튼 클릭 실행!
            if (targetButton && availableButtons.includes(targetButton)) {
                console.log(`  [✨ Self-Healing] AI decided to click: "${targetButton}"`);
                const btnToClick = dialog.$(`.//Button[@Name="${targetButton}"]`);
                await btnToClick.click();
                // 다이얼로그가 닫힐 때까지 대기 (최대 3초)
                await browser.waitUntil(
                    async () => {
                        try { return !(await dialog.isExisting()); } catch { return true; }
                    },
                    { timeout: 3000, interval: 200, timeoutMsg: '' }
                ).catch(() => { /* 다이얼로그가 유지되더라도 다음 단계 진행 */ });
                return true;
            } else {
                console.log(`  [❌ Self-Healing] AI failed to decide or picked invalid button: ${targetButton}`);
                return false;
            }

        } catch (err) {
            // 에러가 나도 프로그램이 죽지 않도록 조용히 무시 (Self-healing의 기본)
            console.warn('  [Self-Healing Warning] Could not process dialog:', err instanceof Error ? err.message : err);
            return false;
        }
    }
}

export const idmPage = new IdmPage();
