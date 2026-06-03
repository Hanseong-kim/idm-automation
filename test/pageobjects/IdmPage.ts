import * as fs from 'fs';
import * as path from 'path';
import type { DownloadItem } from '../../src/agent/types';
import { execSync } from 'child_process';

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
        await browser.pause(2000);
        console.log('[Action] Completed successfully');
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
        await browser.pause(2000);
        console.log('[Action] Completed successfully');
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
                    const items = await this.getListItems();
                    const currentStatus = await this.getItemStatus(items[index]);
                    if (DEBUG_MODE) console.log('[Status Check] Current:', currentStatus);
                    return lower.some(s => currentStatus.includes(s));
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
    async addUrlDownload(url: string): Promise<void> {
        await this.waitForReady();

        // 1. 툴바 인덱스를 사용하여 'Add URL' 버튼 클릭
        console.log('[IDMPage] Clicking "Add URL" button...');
        await this.clickToolbarButton(SEL.TB_ADD_URL);

        // 2. 주소 입력 다이얼로그 대기
        const addressDialog = await $('//Window[@ClassName="#32770"]');
        await addressDialog.waitForExist({ timeout: 5000 });
        
        const editBox = await addressDialog.$('.//Edit'); 
        await editBox.waitForExist({ timeout: 5000 });
        
        // 확실한 포커스 확보 (이 클릭 덕분에 PowerShell SendKeys가 정확히 IDM에 들어갑니다)
        await editBox.click();
        await browser.pause(500); 
        
        // 3. PowerShell을 이용한 클립보드 붙여넣기 (WinAppDriver 버그 완벽 우회)
        console.log('[IDMPage] Pasting URL via Native OS PowerShell...');
        const psCommand = `Set-Clipboard -Value '${url}'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^a^v')`;
        execSync(`powershell -command "${psCommand}"`);
        
        await browser.pause(800);
        
        // 4. OK 버튼 클릭
        const okBtn = await addressDialog.$('.//Button[@Name="OK" or @Name="확인"]');
        await okBtn.click();

        // 5. 자가 복구 실행 (중복 다운로드 경고창 등 처리)
        await this.handleUnexpectedDialog("I want to add and start downloading this URL file.");

        // 6. '다운로드 시작' 버튼 대기 및 클릭 (최적화)
        console.log('[IDMPage] Waiting for Download File Info dialog...');
        
        const startBtn = await $('//Window//Button[@Name="Start Download" or @Name="다운로드 시작" or @Name="시작"]');
        
        try {
            // [수정] 15초 대기 -> 5초 대기로 단축
            await startBtn.waitForExist({ timeout: 5000 }); 
            await startBtn.click();
            console.log('[IDMPage] "Start Download" clicked successfully.');
        } catch (e) {
            // [핵심 수정] 에러(throw new Error)를 던지지 않습니다!
            // 중복 파일 팝업에서 OK를 누르면 버튼 없이 바로 시작되는 경우가 있기 때문입니다.
            console.log('[IDMPage] "Start Download" button not found. Assuming download started automatically or was handled by Self-Healing.');
        }
    }


    // -----------------------------------------------------------------------
    // Bonus Feature: Self-Healing Automation (UI Tree OCR + LLM)
    // -----------------------------------------------------------------------
    async handleUnexpectedDialog(intent: string): Promise<boolean> {
        console.log('[Self-Healing] Scanning for unexpected dialogs...');
        try {
            // 1. 현재 떠 있는 최상단 팝업(Window) 찾기 (메인 창 제외)
            const activeWindow = await $('//Window[@ClassName="#32770"]');
            
            // 15초(15번) 정도 짧게 기다리며 팝업이 뜰 시간을 줍니다
            let isDialogExists = false;
            for(let i=0; i<3; i++) {
                if(await activeWindow.isExisting()) { isDialogExists = true; break; }
                await browser.pause(500);
            }
            if (!isDialogExists) return false; // 아무 창도 안 떴으면 종료

            // 2. 팝업창 내의 모든 텍스트(Text) 긁어오기
            const textElements = await activeWindow.$$('.//Text');
            let dialogText = '';
            for (const el of textElements) {
                const text = await el.getText().catch(() => '');
                if (text) dialogText += text + ' ';
            }

            // 3. 팝업창 내의 누를 수 있는 모든 버튼(Button) 이름 긁어오기
            const buttonElements = await activeWindow.$$('.//Button');
            const availableButtons: string[] = [];
            for (const el of buttonElements) {
                const name = await el.getAttribute('Name').catch(() => '');
                if (name && name.trim() !== '') availableButtons.push(name);
            }

            if (!dialogText.trim() || availableButtons.length === 0) {
                return false; // 읽을 텍스트나 버튼이 없으면 포기
            }

            console.log(`\n  [🤖 UI Scanner] Detected Dialog!`);
            console.log(`  - Message: "${dialogText.trim()}"`);
            console.log(`  - Buttons: [${availableButtons.join(', ')}]`);

            // 4. Llama 3(Ollama)에게 프롬프트를 보내서 스스로 판단하게 함
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
                console.log(`  [✨ Self-Healing] Llama 3 decided to click: "${targetButton}"`);
                const btnToClick = await activeWindow.$(`.//Button[@Name="${targetButton}"]`);
                await btnToClick.click();
                await browser.pause(1000); // 클릭 후 애니메이션 대기
                return true;
            } else {
                console.log(`  [❌ Self-Healing] Llama 3 failed to decide or picked invalid button: ${targetButton}`);
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
