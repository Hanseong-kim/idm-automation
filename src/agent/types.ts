export type ActionType = 'start' | 'pause' | 'resume' | 'delete' | 'list' | 'clear';

export interface IdmCommand {
    action: ActionType;
    target: string;
    index?: number;
}

export interface DownloadItem {
    index: number;
    fileName: string;
    size: string;
    status: string;
    progress: string;
}

export interface CommandResult {
    success: boolean;
    message: string;
    data?: DownloadItem[];
}
