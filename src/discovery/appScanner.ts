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
        buttons: UIElement[];
        lists: UIElement[];
        toolbars: UIElement[];
        menuItems: UIElement[];
    };
    stats: ScanStats;
    workflows: GeneratedWorkflow[];
}

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

function buildWorkflows(elements: ScanResult['elements'], windowTitle: string): GeneratedWorkflow[] {
    const workflows: GeneratedWorkflow[] = [];
    const btns = elements.buttons;

    const addBtn  = btns.find(b => /추가|add.*url/i.test(b.name));
    const startBtn = btns.find(b => /^(시작|resume|start)/i.test(b.name));
    const pauseBtn = btns.find(b => /^(중지|pause|stop)/i.test(b.name) && !/all|모두/i.test(b.name));
    const deleteBtn = btns.find(b => /제거|delete|remove/i.test(b.name) && !/all|모두/i.test(b.name));

    if (addBtn) {
        workflows.push({
            name: 'Add New Download',
            triggerElement: addBtn.name,
            steps: [
                `Click "${addBtn.name}" button`,
                'Enter download URL in Add URL dialog',
                'Click OK/Start to queue the download',
            ],
        });
    }

    if (startBtn) {
        workflows.push({
            name: 'Start / Resume Download',
            triggerElement: startBtn.name,
            steps: [
                'Select download item from SysListView32',
                `Click "${startBtn.name}" toolbar button`,
                'Wait for status → Downloading / Connecting',
            ],
        });
    }

    if (pauseBtn) {
        workflows.push({
            name: 'Pause Download',
            triggerElement: pauseBtn.name,
            steps: [
                'Select download item from SysListView32',
                `Click "${pauseBtn.name}" toolbar button`,
                'Wait for status → Paused / Stopped',
            ],
        });
    }

    if (deleteBtn) {
        workflows.push({
            name: 'Delete Download',
            triggerElement: deleteBtn.name,
            steps: [
                'Select download item from SysListView32',
                `Click "${deleteBtn.name}" toolbar button`,
                'Wait 500ms for confirmation dialog',
                'Click "예" / OK to confirm deletion',
                'Verify item removed from list (timeout 20s)',
            ],
        });
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
                `${btns.length} button(s) discovered`,
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

    const elements = { buttons, lists, toolbars, menuItems };
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

    if (result.elements.buttons.length > 0) {
        console.log('\nDISCOVERED BUTTONS\n');
        result.elements.buttons.forEach((btn, i) => {
            const st = btn.isEnabled ? '✓' : '✗ disabled';
            const aid = btn.automationId ? `  aid:${btn.automationId}` : '';
            console.log(`  [${i}] "${btn.name || '(unnamed)'}"`  + aid + `  [${st}]`);
        });
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
