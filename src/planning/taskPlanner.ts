import type { IdmCommand, ActionType } from '../agent/types';

export interface PlanStep {
    n: number;
    description: string;
}

export interface ExecutionPlan {
    commandText: string;
    command: IdmCommand;
    steps: PlanStep[];
    estimatedSeconds: number;
}

const TEMPLATES: Record<ActionType, (t: string) => string[]> = {
    add: (t) => [
        'Open Add URL dialog (toolbar btn 0)',
        `Paste download URL: ${t}`,
        'Confirm URL input (OK/확인)',
        'Wait for File Info dialog',
        'Click "Start Download" to begin (scan dialog buttons)',
    ],
    pause: (t) => [
        `Locate download "${t}" in IDM list`,
        'Select the download item',
        'Click Pause toolbar button (btn 2)',
        'Wait for status to change to "Paused"',
        'Verify pause succeeded',
    ],
    resume: (t) => [
        `Locate paused download "${t}"`,
        'Select the download item',
        'Click Start/Resume toolbar button (btn 1)',
        'Wait for download to resume',
        'Verify status is now active',
    ],
    start: (t) => [
        `Locate queued/stopped download "${t}"`,
        'Select the download item',
        'Click Start toolbar button (btn 1)',
        'Wait for transfer to begin',
        'Verify download is active',
    ],
    delete: (t) => [
        `Locate download "${t}" in list`,
        'Select the download item',
        'Click Delete toolbar button (btn 4)',
        'Handle confirmation dialog',
        'Verify item removed from list',
    ],
    list: () => [
        'Access IDM download list (SysListView32)',
        'Extract all download items and metadata',
        'Format and display results',
    ],
    clear: () => [
        'Scan list for completed downloads (100%, "완료", "done")',
        'Select each completed item',
        'Delete each completed item',
        'Verify all completed downloads removed',
    ],
};

const ETA: Record<ActionType, number> = {
    add: 5, list: 1, pause: 3, resume: 3, start: 3, delete: 5, clear: 8,
};

function resolveLabel(cmd: IdmCommand): string {
    if (cmd.index !== undefined) {
        if (cmd.index === -1) return 'last download';
        const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
        return (ORDINALS[cmd.index] ?? `#${cmd.index + 1}`) + ' download';
    }
    if (cmd.target && cmd.target !== '*') return cmd.target;
    return 'all downloads';
}

export function generatePlan(cmd: IdmCommand, commandText: string): ExecutionPlan {
    const t = resolveLabel(cmd);
    const descs = TEMPLATES[cmd.action](t);
    return {
        commandText,
        command: cmd,
        steps: descs.map((description, i) => ({ n: i + 1, description })),
        estimatedSeconds: ETA[cmd.action],
    };
}

export function printPlan(plan: ExecutionPlan): void {
    console.log(`\nTask Plan: "${plan.commandText}"`);
    console.log(`Action: ${plan.command.action.toUpperCase()}  |  Estimated: ~${plan.estimatedSeconds}s`);
    console.log('Steps:');
    const last = plan.steps.length;
    for (const { n, description } of plan.steps) {
        const branch = n === last ? '  └──' : '  ├──';
        console.log(`${branch} ${n}. ${description}`);
    }
    console.log('');
}
