import type { ActionType, IdmCommand } from './types';

// ---------------------------------------------------------------------------
// Regex fallback parser (kept intact as the safety net)
// ---------------------------------------------------------------------------

type ActionPattern = { pattern: RegExp; action: ActionType };
type IndexResolver = { pattern: RegExp; resolve: (m: RegExpMatchArray) => number };

// Order matters: 'resume' before 'start' to avoid capturing "start (resume)"
const ACTION_PATTERNS: ActionPattern[] = [
    { pattern: /\b(clear|clean\s*up|remove\s*completed|delete\s*completed)\b/i, action: 'clear'  },
    { pattern: /\b(resume|continue|unpause)\b/i,                                action: 'resume' },
    { pattern: /\b(start|begin|download again)\b/i,                             action: 'start'  },
    { pattern: /\b(pause|suspend|halt|stop)\b/i,                                action: 'pause'  },
    { pattern: /\b(delete|remove|cancel)\b/i,                                   action: 'delete' },
    { pattern: /\b(list|show|display|get all|what are|what|view)\b/i,           action: 'list'   },
];

const INDEX_RESOLVERS: IndexResolver[] = [
    { pattern: /\bfirst\b/i,                                    resolve: () => 0  },
    { pattern: /\bsecond\b/i,                                   resolve: () => 1  },
    { pattern: /\bthird\b/i,                                    resolve: () => 2  },
    { pattern: /\b(\d+)(?:st|nd|rd|th)\b/i,                    resolve: (m) => parseInt(m[1], 10) - 1 },
    { pattern: /\b(?:number|#|no\.?|index)\s*(\d+)\b/i,        resolve: (m) => parseInt(m[1], 10) - 1 },
    { pattern: /\blast\b/i,                                     resolve: () => -1 },
];

export function parseNaturalLanguage(input: string): IdmCommand {
    if (!input.trim()) {
        throw new Error('Empty command. Try: "pause ubuntu.iso" or "list all downloads".');
    }

    let action: ActionType | undefined;
    for (const ap of ACTION_PATTERNS) {
        if (ap.pattern.test(input)) {
            action = ap.action;
            break;
        }
    }
    if (!action) {
        throw new Error(
            `Cannot determine action from: "${input}". ` +
            'Supported: start, pause, resume, delete, list, clear'
        );
    }

    let index: number | undefined;
    for (const ir of INDEX_RESOLVERS) {
        const m = input.match(ir.pattern);
        if (m) {
            index = ir.resolve(m);
            break;
        }
    }

    const target = extractTarget(input);
    return { action, target, index };
}

function extractTarget(input: string): string {
    const cleaned = input
        .replace(/\b(start|begin|pause|suspend|halt|stop|resume|continue|unpause|delete|remove|cancel|list|show|display|get|clear|clean\s*up)\b/gi, '')
        .replace(/\b(the|a|an|all|my|this|that|first|second|third|last|download|downloads|file|files|item|items|please|completed|finished)\b/gi, '')
        .replace(/\b(\d+(?:st|nd|rd|th)?|#\d+|number\s*\d+|index\s*\d+|no\.\s*\d+)\b/gi, '')
        .replace(/[,;!?]+/g, ' ')   // preserve '.' so "ubuntu.iso" survives
        .replace(/\s+/g, ' ')
        .trim();

    return cleaned || '*';
}

// ---------------------------------------------------------------------------
// Gemini LLM-based parser (native fetch, no SDK dependency)
// ---------------------------------------------------------------------------

const GEMINI_URL =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a command parser for Internet Download Manager (IDM).
Parse English natural language commands only into a structured IDM command.

Return a JSON object with exactly these fields:
- action: one of "start" | "pause" | "resume" | "delete" | "list" | "clear"
- target: filename or keyword to match (use "*" for all/wildcard)
- index: 0-based integer if a specific position is mentioned, omit otherwise
  (use -1 for "last")

"clear" removes ALL completed downloads — use it for "clean up", "clear completed", "remove finished".

Examples:
Input: "list all downloads"           → {"action":"list","target":"*"}
Input: "pause the first download"     → {"action":"pause","target":"*","index":0}
Input: "resume ubuntu.iso"            → {"action":"resume","target":"ubuntu.iso"}
Input: "delete the last item"         → {"action":"delete","target":"*","index":-1}
Input: "start 3rd download"           → {"action":"start","target":"*","index":2}
Input: "clear all completed"          → {"action":"clear","target":"*"}
Input: "can you stop download #2?"    → {"action":"pause","target":"*","index":1}
Input: "show me what's downloading"   → {"action":"list","target":"*"}`;

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        action: {
            type: 'STRING',
            enum: ['start', 'pause', 'resume', 'delete', 'list', 'clear'],
        },
        target: { type: 'STRING' },
        index:  { type: 'INTEGER' },
    },
    required: ['action', 'target'],
};

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
    error?: { message?: string };
}

function isValidIdmCommand(obj: unknown): obj is IdmCommand {
    if (typeof obj !== 'object' || obj === null) return false;
    const o = obj as Record<string, unknown>;
    const validActions: string[] = ['start', 'pause', 'resume', 'delete', 'list', 'clear'];
    if (!validActions.includes(o['action'] as string)) return false;
    if (typeof o['target'] !== 'string') return false;
    if ('index' in o && typeof o['index'] !== 'number') return false;
    return true;
}

export async function parseWithLLM(text: string): Promise<IdmCommand | null> {
    const apiKey = process.env['LLM_API_KEY'];
    if (!apiKey) return null;

    const body = {
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
        },
    };

    const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!resp.ok) {
        throw new Error(`Gemini API error ${resp.status}: ${await resp.text()}`);
    }

    const data = await resp.json() as GeminiResponse;

    if (data.error?.message) {
        throw new Error(`Gemini error: ${data.error.message}`);
    }

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        return null;
    }

    return isValidIdmCommand(parsed) ? parsed : null;
}

export async function parseWithOllama(text: string): Promise<IdmCommand | null> {
    try {
        const body = {
            model: 'llama3',
            format: 'json', // Ollama에게 JSON 형태로만 응답하도록 강제
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text }
            ],
            stream: false // 한 번에 응답을 받기 위해 stream을 끕니다
        };

        const resp = await fetch('http://localhost:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!resp.ok) {
            throw new Error(`Ollama API error ${resp.status}`);
        }

        const data = await resp.json();
        const rawText = data.message?.content;
        if (!rawText) return null;

        const parsed = JSON.parse(rawText);
        return isValidIdmCommand(parsed) ? parsed : null;
    } catch (err) {
        console.error('[Ollama Error]', err);
        return null;
    }
}


// ---------------------------------------------------------------------------
// Main entry point: LLM first, regex fallback
// ---------------------------------------------------------------------------

// Known action keywords — if NONE appear in user input, reject any LLM result
// (prevents Gemini from mapping gibberish like "abcxyz" to action:'list')
const KNOWN_ACTION_RE =
    /\b(start|begin|pause|stop|suspend|halt|resume|continue|unpause|delete|remove|cancel|list|show|display|view|clear)\b/i;

// ---------------------------------------------------------------------------
// Main entry point: 환경 변수에 따라 모델 스위칭 (LLM first, regex fallback)
// ---------------------------------------------------------------------------
export async function parseCommand(text: string): Promise<IdmCommand> {
    if (!text.trim()) {
        throw new Error('Empty command. Try: "pause ubuntu.iso" or "list all downloads".');
    }

    try {
        const aiProvider = process.env['AI_PROVIDER'] || 'gemini';
        let llmResult = null;

        if (aiProvider === 'ollama') {
            // Ollama 로컬 모델 사용 (로컬 모델은 첫 구동 시 약간 느릴 수 있어 타임아웃을 15초로 넉넉히 줍니다)
            console.log('[Agent] Routing request to local Ollama (Llama 3)...');
            llmResult = await Promise.race([
                parseWithOllama(text),
                new Promise((resolve) => setTimeout(() => resolve(null), 15000)),
            ]) as IdmCommand | null;
        } else {
            // 기존 Gemini API 사용
            console.log('[Agent] Routing request to Gemini...');
            llmResult = await Promise.race([
                parseWithLLM(text),
                new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
            ]) as IdmCommand | null;
        }

        if (llmResult) return llmResult;

        // LLM이 실패하거나 타임아웃 났을 때 Fallback 로직
        console.warn(`[Agent Warning] ${aiProvider} parsing failed or timed out. Falling back to Regex parser.`);

    } catch (err) {
        console.warn('[Agent Warning] LLM parsing failed. Falling back to Regex parser.', err instanceof Error ? err.message : err);
    }

    return parseNaturalLanguage(text);
}
