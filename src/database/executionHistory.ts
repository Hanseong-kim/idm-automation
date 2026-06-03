import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DB_DIR  = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'history.db');

export interface ExecutionRecord {
    command_text: string;
    action: string;
    target: string;
    success: boolean;
    duration_ms: number;
    error_message?: string;
}

export interface HistoryRow {
    id: number;
    timestamp: string;
    command_text: string;
    action: string;
    target: string;
    success: number;    // SQLite 0/1
    duration_ms: number;
    error_message: string | null;
}

export interface StatsResult {
    total: number;
    successCount: number;
    successRate: number;
    mostUsedAction: string;
    avgDurationMs: number;
}

let db: Database.Database | null = null;

export function initDatabase(): Database.Database {
    if (db) return db;
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS executions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     TEXT    NOT NULL,
            command_text  TEXT    NOT NULL,
            action        TEXT    NOT NULL,
            target        TEXT    NOT NULL,
            success       INTEGER NOT NULL,
            duration_ms   INTEGER NOT NULL,
            error_message TEXT
        )
    `);
    return db;
}

export function saveExecution(record: ExecutionRecord): void {
    try {
        initDatabase().prepare(`
            INSERT INTO executions
                (timestamp, command_text, action, target, success, duration_ms, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            new Date().toISOString(),
            record.command_text,
            record.action,
            record.target,
            record.success ? 1 : 0,
            record.duration_ms,
            record.error_message ?? null,
        );
    } catch {
        // Non-fatal: DB write failure never aborts automation
    }
}

export function getRecentHistory(limit = 10): HistoryRow[] {
    try {
        return initDatabase()
            .prepare('SELECT * FROM executions ORDER BY id DESC LIMIT ?')
            .all(limit) as HistoryRow[];
    } catch {
        return [];
    }
}

export function getStats(): StatsResult {
    try {
        const database = initDatabase();
        const total       = (database.prepare('SELECT COUNT(*) AS n FROM executions').get() as { n: number }).n;
        const successCount = (database.prepare('SELECT COUNT(*) AS n FROM executions WHERE success=1').get() as { n: number }).n;
        const top         = database.prepare(
            'SELECT action, COUNT(*) AS n FROM executions GROUP BY action ORDER BY n DESC LIMIT 1'
        ).get() as { action: string; n: number } | undefined;
        const avgMs       = (database.prepare('SELECT AVG(duration_ms) AS a FROM executions').get() as { a: number | null }).a ?? 0;
        return {
            total,
            successCount,
            successRate:    total > 0 ? Math.round((successCount / total) * 100) : 0,
            mostUsedAction: top?.action ?? '—',
            avgDurationMs:  Math.round(avgMs),
        };
    } catch {
        return { total: 0, successCount: 0, successRate: 0, mostUsedAction: '—', avgDurationMs: 0 };
    }
}
