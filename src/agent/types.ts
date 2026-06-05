// types.ts
export type ActionType = 'add' | 'start' | 'pause' | 'resume' | 'delete' | 'list' | 'clear';

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
    transferRate: string;    // Text[6] 원본 (예 "11.45 MB/sec", 멈추면 "")
    isTransferring: boolean; // transferRate에 0 초과 숫자가 있으면 true
}

export interface CommandResult {
    success: boolean;
    message: string;
    data?: DownloadItem[];
}
