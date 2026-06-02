import * as fs from 'fs';
import * as path from 'path';

export type LogStatus = 'success' | 'failure' | 'info' | 'warning';

export class ExecutionMonitor {
    private readonly logPath: string;
    private startTime = 0;

    constructor() {
        const logsDir = path.join(process.cwd(), 'logs');
        fs.mkdirSync(logsDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        this.logPath = path.join(logsDir, `audit-${ts}.log`);
        this.append(`=== IDM Automation Audit Log — ${new Date().toLocaleString()} ===\n`);
    }

    startCommand(text: string): void {
        this.startTime = Date.now();
        this.append(`\n[${ts()}] [INFO] START: "${text}"\n`);
        console.log(`\n[Monitor] Executing: "${text}"`);
    }

    step(n: number, total: number, description: string, ok: boolean, error?: string): void {
        const icon = ok ? '✓' : '✗';
        const msg = error ? `${description} — ${error}` : description;
        const status = ok ? 'SUCCESS' : 'FAILURE';
        console.log(`  [${icon}] Step ${n}/${total}: ${msg}`);
        this.append(`[${ts()}] [${status}] Step ${n}/${total}: ${msg}\n`);
    }

    success(message: string): void {
        console.log(`  [✓] ${message}`);
        this.append(`[${ts()}] [SUCCESS] ${message}\n`);
    }

    failure(message: string): void {
        console.log(`  [✗] ${message}`);
        this.append(`[${ts()}] [FAILURE] ${message}\n`);
    }

    info(message: string): void {
        this.append(`[${ts()}] [INFO] ${message}\n`);
    }

    endCommand(text: string, ok: boolean): void {
        const ms = Date.now() - this.startTime;
        const icon = ok ? '✓' : '✗';
        const label = ok ? 'completed successfully' : 'failed';
        console.log(`\n  [${icon}] "${text}" ${label} in ${ms}ms`);
        console.log(`  Audit log: ${this.logPath}`);
        this.append(`[${ts()}] [INFO] END: "${text}" — ${label} (${ms}ms)\n`);
    }

    getLogPath(): string {
        return this.logPath;
    }

    private append(line: string): void {
        try {
            fs.appendFileSync(this.logPath, line, 'utf8');
        } catch {
            // non-fatal: log write failure does not abort automation
        }
    }
}

function ts(): string {
    return new Date().toISOString();
}
