import type { IdmCommand, CommandResult, DownloadItem } from './types';
import type { ExecutionMonitor } from '../monitoring/executionMonitor';
import { resolveTarget } from './targetResolver';
import { saveExecution } from '../database/executionHistory';

export interface UiFunctions {
    extractDownloads(): Promise<DownloadItem[]>;
    startDownload(item: DownloadItem): Promise<void>;
    pauseDownload(item: DownloadItem): Promise<void>;
    resumeDownload(item: DownloadItem): Promise<void>;
    deleteDownload(item: DownloadItem): Promise<void>;
    clearCompleted(): Promise<number>;
    addUrlDownload(url: string): Promise<void>;
}

export async function dispatch(
    command: IdmCommand,
    ui: UiFunctions,
    monitor?: ExecutionMonitor,
    rawText?: string,
): Promise<CommandResult> {
    const { action, target, index } = command;
    const startMs = Date.now();

    const record = (): void => {
        const result_ref = resultRef;
        saveExecution({
            command_text: rawText ?? action,
            action,
            target: target ?? '*',
            success:     result_ref?.success ?? false,
            duration_ms: Date.now() - startMs,
            error_message: result_ref?.success ? undefined : result_ref?.message,
        });
    };

    let resultRef: CommandResult | null = null;

    try {
        monitor?.step(1, 3, 'Extracting download list from IDM', true);
        const downloads = await ui.extractDownloads();

        if (action === 'list') {
            if (downloads.length === 0) {
                const msg = 'No downloads in IDM queue.';
                monitor?.success(msg);
                console.log(`[IDM Agent] ${msg}`);
                resultRef = { success: true, message: msg, data: [] };
                record();
                return resultRef;
            }
            console.log(`[IDM Agent] Downloads (${downloads.length}):`);
            downloads.forEach(d => {
                console.log(`  [${d.index + 1}] ${d.fileName} | ${d.size} | ${d.status} | ${d.progress}`);
            });
            const msg = `Listed ${downloads.length} download(s).`;
            monitor?.success(msg);
            resultRef = { success: true, message: msg, data: downloads };
            record();
            return resultRef;
        }

        if (action === 'clear') {
            monitor?.step(2, 3, 'Scanning for completed downloads', true);
            const count = await ui.clearCompleted();
            const msg = count > 0
                ? `Cleared ${count} completed download(s).`
                : 'No completed downloads to clear.';
            monitor?.step(3, 3, msg, true);
            console.log(`[IDM Agent] ${msg}`);
            resultRef = { success: true, message: msg };
            record();
            return resultRef;
        }

        const isUrl = target && /^https?:\/\//i.test(target);
        if (action === 'start' && isUrl) {
            monitor?.step(2, 3, `Adding new download from URL: ${target}`, true);
            await ui.addUrlDownload(target);
            const msg = `URL download started successfully: ${target}`;
            monitor?.step(3, 3, msg, true);
            console.log(`[IDM Agent] ${msg}`);
            resultRef = { success: true, message: msg };
            record();
            return resultRef;
        }

        monitor?.step(2, 3, `Resolving target: "${target ?? 'all'}"`, true);
        const targets = resolveTarget(target, downloads, index);
        monitor?.success(`Target resolved — ${targets.length} item(s): ${targets.map(t => `"${t.fileName}"`).join(', ')}`);

        const messages: string[] = [];
        const pastTense: Record<string, string> = {
            start:  'started',
            pause:  'paused',
            resume: 'resumed',
            delete: 'deleted',
        };

        for (const item of targets) {
            try {
                switch (action) {
                    case 'start':  await ui.startDownload(item);  break;
                    case 'pause':  await ui.pauseDownload(item);  break;
                    case 'resume': await ui.resumeDownload(item); break;
                    case 'delete': await ui.deleteDownload(item); break;
                }
                const verb = pastTense[action] ?? `${action}d`;
                const msg = `"${item.fileName}" ${verb} successfully.`;
                messages.push(msg);
                monitor?.step(3, 3, msg, true);
                console.log(`[IDM Agent] ${msg}`);
            } catch (itemErr) {
                const raw = itemErr instanceof Error ? itemErr.message : String(itemErr);
                monitor?.step(3, 3, `Failed to ${action} "${item.fileName}"`, false, raw);
                throw itemErr;
            }
        }

        resultRef = { success: true, message: messages.join('\n') };
        record();
        return resultRef;
    } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = raw.startsWith('FAILED:') ? raw : `FAILED: ${raw}`;
        monitor?.failure(message);
        console.error(`[IDM Agent] ${message}`);
        resultRef = { success: false, message };
        record();
        return resultRef;
    }
}
