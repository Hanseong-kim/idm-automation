import type { IdmCommand, CommandResult, DownloadItem } from './types';
import { resolveTarget } from './targetResolver';

export interface UiFunctions {
    extractDownloads(): Promise<DownloadItem[]>;
    startDownload(item: DownloadItem): Promise<void>;
    pauseDownload(item: DownloadItem): Promise<void>;
    resumeDownload(item: DownloadItem): Promise<void>;
    deleteDownload(item: DownloadItem): Promise<void>;
    clearCompleted(): Promise<number>;
}

export async function dispatch(command: IdmCommand, ui: UiFunctions): Promise<CommandResult> {
    const { action, target, index } = command;

    try {
        const downloads = await ui.extractDownloads();

        if (action === 'list') {
            if (downloads.length === 0) {
                const msg = 'No downloads in IDM queue.';
                console.log(`[IDM Agent] ${msg}`);
                return { success: true, message: msg, data: [] };
            }
            console.log(`[IDM Agent] Downloads (${downloads.length}):`);
            downloads.forEach(d => {
                console.log(`  [${d.index + 1}] ${d.fileName} | ${d.size} | ${d.status} | ${d.progress}`);
            });
            return { success: true, message: `Listed ${downloads.length} download(s).`, data: downloads };
        }

        if (action === 'clear') {
            const count = await ui.clearCompleted();
            const msg = count > 0
                ? `Cleared ${count} completed download(s).`
                : 'No completed downloads to clear.';
            console.log(`[IDM Agent] ${msg}`);
            return { success: true, message: msg };
        }

        const targets = resolveTarget(target, downloads, index);
        const messages: string[] = [];

        const pastTense: Record<string, string> = {
            start:  'started',
            pause:  'paused',
            resume: 'resumed',
            delete: 'deleted',
        };

        for (const item of targets) {
            switch (action) {
                case 'start':  await ui.startDownload(item);  break;
                case 'pause':  await ui.pauseDownload(item);  break;
                case 'resume': await ui.resumeDownload(item); break;
                case 'delete': await ui.deleteDownload(item); break;
            }
            const verb = pastTense[action] ?? `${action}d`;
            const msg = `"${item.fileName}" ${verb} successfully.`;
            messages.push(msg);
            console.log(`[IDM Agent] ${msg}`);
        }

        return { success: true, message: messages.join('\n') };
    } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const message = raw.startsWith('FAILED:') ? raw : `FAILED: ${raw}`;
        console.error(`[IDM Agent] ${message}`);
        return { success: false, message };
    }
}
