export interface ScreenNode {
    name: string;
    type: 'screen' | 'action' | 'state' | 'dialog';
    children?: ScreenNode[];
}

export interface Workflow {
    name: string;
    description: string;
    steps: string[];
    preconditions: string[];
    postconditions: string[];
}

export interface WorkflowMap {
    app: string;
    discoveredAt: string;
    screens: ScreenNode[];
    workflows: Workflow[];
    navMap: string;
}

const SCREENS: ScreenNode[] = [
    {
        name: 'IDM Main Window',
        type: 'screen',
        children: [
            {
                name: 'Menu Bar',
                type: 'screen',
                children: [
                    { name: 'Downloads', type: 'action' },
                    { name: 'Downloads → Add URL', type: 'action' },
                    { name: 'Downloads → Options', type: 'action' },
                    { name: 'View', type: 'action' },
                    { name: 'Help', type: 'action' },
                ],
            },
            {
                name: 'Toolbar',
                type: 'screen',
                children: [
                    { name: 'Add URL Button (btn 0)', type: 'action' },
                    { name: 'Start/Resume Button (btn 1)', type: 'action' },
                    { name: 'Pause Button (btn 2)', type: 'action' },
                    { name: 'Stop All Button (btn 3)', type: 'action' },
                    { name: 'Delete Button (btn 4)', type: 'action' },
                    { name: 'Properties Button', type: 'action' },
                ],
            },
            {
                name: 'Download List — SysListView32',
                type: 'screen',
                children: [
                    { name: 'Row: [File Name | Size | Status | Progress | URL]', type: 'state' },
                    {
                        name: 'Context Menu (right-click)',
                        type: 'dialog',
                        children: [
                            { name: 'Start Download', type: 'action' },
                            { name: 'Pause Download', type: 'action' },
                            { name: 'Delete', type: 'action' },
                            { name: 'Properties', type: 'action' },
                            { name: 'Copy Download Link', type: 'action' },
                            { name: 'Open File Location', type: 'action' },
                            { name: 'Remove from Queue', type: 'action' },
                        ],
                    },
                ],
            },
            { name: 'Status Bar (speed · total progress)', type: 'state' },
        ],
    },
    {
        name: 'Add Download Dialog',
        type: 'dialog',
        children: [
            { name: 'URL Input Field', type: 'action' },
            { name: 'Start Download Button', type: 'action' },
            { name: 'Save To Path Field', type: 'action' },
            { name: 'Advanced Options', type: 'action' },
            { name: 'Cancel Button', type: 'action' },
        ],
    },
    {
        name: 'Delete Confirmation Dialog',
        type: 'dialog',
        children: [
            { name: 'Delete File from Disk Checkbox', type: 'action' },
            { name: 'OK Button', type: 'action' },
            { name: 'Cancel Button', type: 'action' },
        ],
    },
    {
        name: 'Properties Dialog',
        type: 'dialog',
        children: [
            { name: 'General Tab', type: 'screen' },
            { name: 'Download Info Tab', type: 'screen' },
            { name: 'Close Button', type: 'action' },
        ],
    },
];

const WORKFLOWS: Workflow[] = [
    {
        name: 'Pause Download',
        description: 'Suspend an active/downloading item',
        steps: [
            'Locate item in SysListView32 by filename or index',
            'Select the download row',
            'Click Pause toolbar button (btn index 2)',
            'Wait for status to change to "Paused"',
            'Verify status in list row',
        ],
        preconditions: ['IDM window open', 'Download is active/downloading'],
        postconditions: ['Status = Paused', 'Transfer halted'],
    },
    {
        name: 'Resume Download',
        description: 'Continue a paused download',
        steps: [
            'Locate paused item in SysListView32',
            'Select the download row',
            'Click Start/Resume toolbar button (btn index 1)',
            'Wait for download to resume',
            'Verify transfer speed > 0',
        ],
        preconditions: ['IDM window open', 'Download is paused'],
        postconditions: ['Status = Downloading', 'Transfer speed > 0'],
    },
    {
        name: 'Delete Download',
        description: 'Remove a download entry from the list',
        steps: [
            'Locate item in SysListView32 by filename or index',
            'Select the download row',
            'Click Delete toolbar button (btn index 4)',
            'Click OK on delete confirmation dialog',
            'Verify item no longer appears in list',
        ],
        preconditions: ['IDM window open', 'Download exists in list'],
        postconditions: ['Item removed from list'],
    },
    {
        name: 'Start Download',
        description: 'Force-start a queued or stopped download',
        steps: [
            'Locate queued/stopped item',
            'Select the download row',
            'Click Start toolbar button (btn index 1)',
            'Wait for transfer to begin',
            'Verify status = Downloading',
        ],
        preconditions: ['IDM window open', 'Download is queued/stopped'],
        postconditions: ['Status = Downloading'],
    },
    {
        name: 'List All Downloads',
        description: 'Read and display every download with metadata',
        steps: [
            'Access main IDM window',
            'Read SysListView32 rows via WinAppDriver',
            'Parse each row: fileName, size, status, progress',
            'Format and display the complete list',
        ],
        preconditions: ['IDM window open'],
        postconditions: ['All downloads displayed with current status'],
    },
    {
        name: 'Clear Completed Downloads',
        description: 'Bulk-remove all 100%-complete entries',
        steps: [
            'Scan list for completed items (100%, "완료", "done")',
            'For each completed item: select and click Delete',
            'Confirm each deletion dialog',
            'Verify list contains no completed downloads',
        ],
        preconditions: ['IDM window open', 'At least one completed download'],
        postconditions: ['All completed downloads removed from list'],
    },
];

const NAV_MAP = [
    'IDM Main Window',
    '  ├── Menu Bar',
    '  │   ├── Downloads → Add URL  ──────────── → [Add Download Dialog]',
    '  │   └── Options               ──────────── → [Options Dialog]',
    '  ├── Toolbar',
    '  │   ├── Add URL (btn 0) ─────────────────  → [Add Download Dialog]',
    '  │   ├── Start/Resume (btn 1) ────────────  → download starts/resumes',
    '  │   ├── Pause (btn 2) ───────────────────  → download pauses',
    '  │   ├── Stop All (btn 3) ────────────────  → all downloads pause',
    '  │   └── Delete (btn 4) ──────────────────  → [Delete Confirm Dialog]',
    '  └── Download List (SysListView32)',
    '      └── Right-click row ─────────────────  → [Context Menu]',
    '          ├── Start / Pause / Delete',
    '          ├── Properties ─────────────────── → [Properties Dialog]',
    '          └── Open File Location',
    '',
    'Dialogs:',
    '  [Add Download Dialog]    — URL → Start → download queued',
    '  [Delete Confirm Dialog]  — OK → removed | Cancel → no change',
    '  [Properties Dialog]      — view/edit download details & save path',
].join('\n');

function renderNode(node: ScreenNode, prefix: string, isLast: boolean): void {
    const branch = isLast ? '└── ' : '├── ';
    const tag = node.type !== 'action' ? ` [${node.type}]` : '';
    console.log(`${prefix}${branch}${node.name}${tag}`);
    if (node.children?.length) {
        const ext = prefix + (isLast ? '    ' : '│   ');
        node.children.forEach((c, i) => renderNode(c, ext, i === node.children!.length - 1));
    }
}

export function discoverWorkflows(): WorkflowMap {
    return {
        app: 'Internet Download Manager (IDMan.exe)',
        discoveredAt: new Date().toISOString(),
        screens: SCREENS,
        workflows: WORKFLOWS,
        navMap: NAV_MAP,
    };
}

export function printWorkflowDiagram(map: WorkflowMap): void {
    const SEP = '═'.repeat(62);
    console.log(`\n${SEP}`);
    console.log(`  APPLICATION : ${map.app}`);
    console.log(`  Discovered  : ${new Date(map.discoveredAt).toLocaleString()}`);
    console.log(`  Screens     : ${map.screens.length}  |  Workflows: ${map.workflows.length}`);
    console.log(SEP);

    console.log('\nUI SCREEN HIERARCHY\n');
    map.screens.forEach((s, i) => renderNode(s, '', i === map.screens.length - 1));

    console.log(`\n${'─'.repeat(62)}`);
    console.log('NAVIGATION MAP\n');
    console.log(map.navMap);

    console.log(`\n${'─'.repeat(62)}`);
    console.log('AVAILABLE WORKFLOWS\n');
    for (const wf of map.workflows) {
        console.log(`  ${wf.name}`);
        console.log(`  ↳ ${wf.description}`);
        wf.steps.forEach((step, i) => {
            const b = i === wf.steps.length - 1 ? '  └──' : '  ├──';
            console.log(`  ${b} ${step}`);
        });
        console.log(`  Pre : ${wf.preconditions.join(' | ')}`);
        console.log(`  Post: ${wf.postconditions.join(' | ')}`);
        console.log('');
    }
    console.log(SEP);
}
