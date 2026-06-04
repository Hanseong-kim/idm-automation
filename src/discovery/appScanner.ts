//appScanner.ts - Perform a live scan of the IDM application UI to discover elements and generate workflows.
import * as fs from 'fs';
import * as path from 'path';

export interface UIElement {
    name: string;
    automationId: string;
    className: string;
    controlType: string;
    isEnabled: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ScanStats {
    buttonCount: number;
    listCount: number;
    dialogCount: number;
    toolbarCount: number;
    menuItemCount: number;
    totalCount: number;
}

export interface GeneratedWorkflow {
    name: string;
    triggerElement?: string;
    steps: string[];
}

export interface ScanResult {
    timestamp: string;
    windowTitle: string;
    elements: {
        buttons: UIElement[];        // XML-parsed, all buttons (includes scrollbars/window controls)
        lists: UIElement[];
        toolbars: UIElement[];
        menuItems: UIElement[];
        toolbarButtons: UIElement[]; // live-queried, index-ordered toolbar buttons only
    };
    stats: ScanStats;
    workflows: GeneratedWorkflow[];
}

// ---------------------------------------------------------------------------
// Toolbar index map — single source of truth.
// Matches REPORT.md §2-2 and IdmPage SEL constants:
//   TB_ADD_URL=0, TB_START=1, TB_PAUSE=2, TB_DELETE=4
// ---------------------------------------------------------------------------
const TOOLBAR_ROLE_MAP = [
    { index: 0, role: 'Add URL',      action: 'add'    },
    { index: 1, role: 'Resume/Start', action: 'start'  },
    { index: 2, role: 'Stop/Pause',   action: 'pause'  },
    { index: 4, role: 'Delete',       action: 'delete' },
] as const;

// 30-second cache to avoid repeated full scans within a single session
let cache: { result: ScanResult; expiresAt: number } | null = null;

function parseAttrs(tag: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /(\w+)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tag)) !== null) attrs[m[1]] = m[2];
    return attrs;
}

function extractByType(xml: string, controlType: string): UIElement[] {
    const result: UIElement[] = [];
    const re = new RegExp(`<${controlType}\\s[^>]+>`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        const a = parseAttrs(m[0]);
        result.push({
            name:         a['Name']         ?? '',
            automationId: a['AutomationId'] ?? '',
            className:    a['ClassName']    ?? '',
            controlType,
            isEnabled: a['IsEnabled'] === 'True',
            x:      parseInt(a['x']      ?? '0', 10),
            y:      parseInt(a['y']      ?? '0', 10),
            width:  parseInt(a['width']  ?? '0', 10),
            height: parseInt(a['height'] ?? '0', 10),
        });
    }
    return result;
}

/**
 * Live-query toolbar buttons via WinAppDriver element API.
 * Union XPath includes both Button and SplitButton so index matches
 * REPORT.md §2-2 (e.g. Delete is SplitButton at index 4).
 * Document order = left-to-right screen order = correct 0-based index.
 * WDIO v9 $$ is not a plain array — manually copy into UIElement[].
 */
async function getToolbarButtons(): Promise<UIElement[]> {
    const raw = await $$('//ToolBar/*[self::Button or self::SplitButton]') as unknown as WebdriverIO.Element[];
    const arr: UIElement[] = [];
    for (let i = 0; i < raw.length; i++) {
        const el = raw[i];
        const name    = (await el.getAttribute('Name').catch(() => '')) ?? '';
        const enabled = (await el.getAttribute('IsEnabled').catch(() => 'true')) !== 'false';
        arr.push({
            name,
            automationId: '',
            className:    '',
            controlType:  'ToolbarButton',
            isEnabled:    enabled,
            x: 0, y: 0, width: 0, height: 0,
        });
    }
    return arr;
}

function buildWorkflows(elements: ScanResult['elements'], windowTitle: string): GeneratedWorkflow[] {
    const workflows: GeneratedWorkflow[] = [];
    const tbBtns = elements.toolbarButtons;

    for (const entry of TOOLBAR_ROLE_MAP) {
        const btn     = tbBtns[entry.index];
        const label   = btn?.name ? `"${btn.name}"` : entry.role;
        const trigger = `Toolbar btn ${entry.index} (${entry.role})`;

        if (entry.action === 'add') {
            workflows.push({
                name: 'Add New Download',
                triggerElement: trigger,
                steps: [
                    `Click ${label} toolbar button (index ${entry.index})`,
                    'Enter download URL in Add URL dialog',
                    'Click OK/Start to queue the download',
                ],
            });
        } else if (entry.action === 'start') {
            workflows.push({
                name: 'Start / Resume Download',
                triggerElement: trigger,
                steps: [
                    'Select download item from SysListView32',
                    `Click ${label} toolbar button (index ${entry.index})`,
                    'Wait for status → Downloading / Connecting',
                ],
            });
        } else if (entry.action === 'pause') {
            workflows.push({
                name: 'Pause Download',
                triggerElement: trigger,
                steps: [
                    'Select download item from SysListView32',
                    `Click ${label} toolbar button (index ${entry.index})`,
                    'Wait for status → Paused / Stopped',
                ],
            });
        } else if (entry.action === 'delete') {
            workflows.push({
                name: 'Delete Download',
                triggerElement: trigger,
                steps: [
                    'Select download item from SysListView32',
                    `Click ${label} toolbar button (index ${entry.index})`,
                    'Wait 500ms for confirmation dialog',
                    'Click "예" / OK to confirm deletion',
                    'Verify item removed from list (timeout 20s)',
                ],
            });
        }
    }

    if (elements.lists.length > 0) {
        const listLabel = elements.lists[0].className || elements.lists[0].automationId || 'SysListView32';
        workflows.push({
            name: 'List All Downloads',
            steps: [
                `Read ${listLabel} download table`,
                'Parse each row: filename, size, status, progress',
                'Format and display the complete list',
            ],
        });
    }

    if (workflows.length === 0) {
        workflows.push({
            name: `Interact with ${windowTitle}`,
            steps: [
                `${elements.buttons.length} button(s) discovered`,
                `${elements.lists.length} list(s) discovered`,
                `${elements.toolbars.length} toolbar(s) discovered`,
            ],
        });
    }

    return workflows;
}

/** Perform a live UI scan. Results are cached for 30 seconds. */
export async function scanApplication(): Promise<ScanResult> {
    if (cache && Date.now() < cache.expiresAt) {
        const secs = Math.round((cache.expiresAt - Date.now()) / 1000);
        console.log(`[Scanner] Using cached scan result (${secs}s remaining)`);
        return cache.result;
    }

    console.log('[Scanner] Starting live UI scan...');

    let windowTitle = 'Unknown';
    try { windowTitle = await browser.getTitle(); } catch { /* ignore */ }

    let xml: string;
    try {
        xml = await browser.getPageSource();
    } catch (e) {
        throw new Error(`[Scanner] getPageSource failed: ${e instanceof Error ? e.message : e}`);
    }

    const buttons    = [...extractByType(xml, 'Button'), ...extractByType(xml, 'SplitButton')];
    const lists      = extractByType(xml, 'List');
    const toolbars   = extractByType(xml, 'ToolBar');
    const menuItems  = extractByType(xml, 'MenuItem');
    const allWindows = extractByType(xml, 'Window');
    const dialogs    = allWindows.filter(w => w.className === '#32770' || w.className === '#32768');

    // Live element query — preserves index order, excludes non-toolbar buttons
    let toolbarButtons: UIElement[] = [];
    try {
        toolbarButtons = await getToolbarButtons();
        console.log(`[Scanner] Toolbar buttons queried: ${toolbarButtons.length}`);
    } catch (e) {
        console.warn('[Scanner] Toolbar button query failed (non-fatal):', e instanceof Error ? e.message : e);
    }

    const elements = { buttons, lists, toolbars, menuItems, toolbarButtons };
    const stats: ScanStats = {
        buttonCount:   buttons.length,
        listCount:     lists.length,
        dialogCount:   dialogs.length,
        toolbarCount:  toolbars.length,
        menuItemCount: menuItems.length,
        totalCount:    buttons.length + lists.length + toolbars.length + menuItems.length,
    };

    const workflows = buildWorkflows(elements, windowTitle);
    const result: ScanResult = { timestamp: new Date().toISOString(), windowTitle, elements, stats, workflows };

    // Save scan JSON to logs/
    try {
        const logsDir = path.join(process.cwd(), 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const outPath = path.join(logsDir, `ui-scan-${ts}.json`);
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
        console.log(`[Scanner] Saved to logs/ui-scan-${ts}.json`);
    } catch { /* non-fatal */ }

    cache = { result, expiresAt: Date.now() + 30_000 };
    return result;
}

/** Print scan summary and generated workflows to console. */
export function printScanResult(result: ScanResult): void {
    const SEP = '═'.repeat(62);
    const { stats } = result;
    console.log(`\n${SEP}`);
    console.log(`  LIVE UI SCAN  —  ${result.windowTitle}`);
    console.log(`  Scanned : ${new Date(result.timestamp).toLocaleString()}`);
    console.log(`  Found   : ${stats.buttonCount} buttons | ${stats.listCount} list(s) | ${stats.dialogCount} dialog(s) | ${stats.toolbarCount} toolbar(s)`);
    console.log(SEP);

    // Core automation targets — live-queried, index-ordered
    console.log('\nTOOLBAR ACTION BUTTONS\n');
    if (result.elements.toolbarButtons.length > 0) {
        result.elements.toolbarButtons.forEach((btn, i) => {
            const roleEntry = TOOLBAR_ROLE_MAP.find(r => r.index === i);
            const st = btn.isEnabled ? '✓' : '✗ disabled';
            if (roleEntry) {
                // 핵심 액션 버튼 (index 0/1/2/4)
                const mainLabel = btn.name ? `"${btn.name}"` : `${roleEntry.role}  (UIA Name 없음)`;
                const suffix    = btn.name ? `  ← ${roleEntry.role}` : '';
                console.log(`  [${i}] ${mainLabel}${suffix}  [${st}]`);
            } else {
                // 역할 미매핑 버튼 (index 3, 5, 6, ...)
                console.log(`      [${i}] "${btn.name || '(unnamed)'}"  [${st}]`);
            }
        });
    } else {
        console.log('  (no toolbar buttons found — WinAppDriver session may not be active)');
    }
    const otherCount = result.elements.buttons.length - result.elements.toolbarButtons.length;
    if (otherCount > 0) {
        console.log(`\n  + ${otherCount} other UI buttons (scrollbars, window controls, etc.) — not listed`);
    }

    if (result.elements.lists.length > 0) {
        console.log('\nDISCOVERED LISTS\n');
        result.elements.lists.forEach((lst, i) => {
            console.log(`  [${i}] class:${lst.className || '—'}  aid:${lst.automationId || '—'}  ${lst.width}×${lst.height}`);
        });
    }

    if (result.elements.toolbars.length > 0) {
        console.log('\nDISCOVERED TOOLBARS\n');
        result.elements.toolbars.forEach((tb, i) => {
            console.log(`  [${i}] "${tb.name || '(toolbar)'}"  aid:${tb.automationId || '—'}`);
        });
    }

    console.log('\nGENERATED WORKFLOWS (from live scan)\n');
    result.workflows.forEach(wf => {
        console.log(`  ${wf.name}`);
        if (wf.triggerElement) console.log(`  ↳ Triggered by: "${wf.triggerElement}"`);
        wf.steps.forEach((step, i) => {
            const b = i === wf.steps.length - 1 ? '  └──' : '  ├──';
            console.log(`  ${b} ${step}`);
        });
        console.log('');
    });

    console.log(SEP);
}
