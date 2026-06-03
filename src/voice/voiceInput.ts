import * as fs from 'fs';
import * as path from 'path';

export class VoiceInput {
    private watching = false;
    private watcher: fs.FSWatcher | null = null;
    private readonly filePath = path.join(process.cwd(), 'voice-input.txt');
    private callback: ((text: string) => void) | null = null;

    start(onCommand: (text: string) => void): void {
        if (!fs.existsSync(this.filePath)) {
            fs.writeFileSync(this.filePath, '', 'utf8');
        }
        this.callback = onCommand;
        this.watching = true;
        this.watcher = fs.watch(this.filePath, () => {
            const text = fs.readFileSync(this.filePath, 'utf8').trim();
            if (text && this.callback) {
                console.log(`[Voice] Command received: "${text}"`);
                fs.writeFileSync(this.filePath, '', 'utf8');
                this.callback(text);
            }
        });
        console.log('[Voice] Watching voice-input.txt for commands...');
        console.log('[Voice] Write a command to voice-input.txt to execute it.');
    }

    stop(): void {
        this.watcher?.close();
        this.watcher = null;
        this.watching = false;
        console.log('[Voice] Voice input stopped.');
    }

    isActive(): boolean {
        return this.watching;
    }
}
