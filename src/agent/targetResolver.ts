import type { DownloadItem } from './types';

// Maps user-friendly keywords to strings that appear in IDM's status column
const STATUS_KEYWORDS: Record<string, string[]> = {
    completed:   ['done', 'finished', 'complete', '100%'],
    downloading: ['downloading', 'in progress', 'resuming', 'connecting'],
    paused:      ['paused', 'stopped', 'queued', 'scheduled'],
    failed:      ['error', 'failed', 'virus'],
};

export function resolveTarget(
    target: string,
    downloads: DownloadItem[],
    index?: number
): DownloadItem[] {
    if (downloads.length === 0) {
        throw new Error('No downloads found in IDM.');
    }

    // Explicit positional index (supports negative: -1 = last)
    if (index !== undefined) {
        const idx = index < 0 ? downloads.length + index : index;
        const item = downloads[idx];
        if (!item) {
            throw new Error(
                `No download at position ${index < 0 ? '"last"' : index + 1}. ` +
                `Total: ${downloads.length}.`
            );
        }
        return [item];
    }

    // Wildcard → all downloads
    if (!target || target === '*' || target.toLowerCase() === 'all') {
        return [...downloads];
    }

    const lowerTarget = target.toLowerCase();

    // Status-based: "completed files", "paused downloads", etc.
    for (const [keyword, statuses] of Object.entries(STATUS_KEYWORDS)) {
        if (lowerTarget.includes(keyword)) {
            const matched = downloads.filter(d =>
                statuses.some(s => d.status.toLowerCase().includes(s))
            );
            if (matched.length > 0) return matched;
        }
    }

    // Filename substring match (case-insensitive)
    const byName = downloads.filter(d =>
        d.fileName.toLowerCase().includes(lowerTarget)
    );
    if (byName.length > 0) return byName;

    throw new Error(
        `No download matching "${target}". ` +
        `Available: ${downloads.map(d => `"${d.fileName}"`).join(', ')}`
    );
}
