import type { ActionType, IdmCommand } from './types';

// ---------------------------------------------------------------------------
// Regex fallback parser (kept intact as the safety net)
// ---------------------------------------------------------------------------

type ActionPattern = { pattern: RegExp; action: ActionType };
type IndexResolver = { pattern: RegExp; resolve: (m: RegExpMatchArray) => number };

// Order matters: 'resume' must be checked before 'start' to avoid false-positive on "start (resume)"
const ACTION_PATTERNS: ActionPattern[] = [
    { pattern: /\b(clear|clean\s*up|remove\s*completed|delete\s*completed)\b/i, action: 'clear'  },
    { pattern: /완료.*(?:삭제|지워|제거|치워|정리)|(?:삭제|지워|제거|치워|정리).*완료/,          action: 'clear'  },
    { pattern: /완료된\s*(?:파일|다운로드|항목)/,                                               action: 'clear'  },
    { pattern: /\b(resume|continue|unpause)\b/i,                                               action: 'resume' },
    { pattern: /\b(start|begin|download again)\b/i,                                            action: 'start'  },
    { pattern: /\b(pause|suspend|halt|stop)\b/i,                                               action: 'pause'  },
    { pattern: /\b(delete|remove|cancel)\b/i,                                                  action: 'delete' },
    { pattern: /\b(list|show|display|get all|what are|what|view)\b/i,                          action: 'list'   },
    // Korean action keywords — delete/cancel checked before start to avoid
    // "시작한 거 취소해" being captured by the 시작 pattern first.
    // 멈춰 is the contracted/colloquial form of 멈추어 (different Unicode codepoint).
    { pattern: /멈추|멈춰|일시정지|중지|스톱/,                                                   action: 'pause'  },
    { pattern: /재개|계속|다시\s*시작/,                                                          action: 'resume' },
    { pattern: /삭제|지워|제거|취소/,                                                            action: 'delete' },
    { pattern: /시작|다운로드\s*시작/,                                                           action: 'start'  },
    { pattern: /목록|리스트|보여|확인|알려/,                                                      action: 'list'   },
];

const INDEX_RESOLVERS: IndexResolver[] = [
    { pattern: /\bfirst\b|첫\s*번째|첫\s*번|맨\s*처음/i,            resolve: () => 0  },
    { pattern: /\bsecond\b|두\s*번째/i,                              resolve: () => 1  },
    { pattern: /\bthird\b|세\s*번째/i,                               resolve: () => 2  },
    { pattern: /\b(\d+)(?:st|nd|rd|th)\b/i,                         resolve: (m) => parseInt(m[1], 10) - 1 },
    { pattern: /\b(?:number|#|no\.?|index)\s*(\d+)\b/i,             resolve: (m) => parseInt(m[1], 10) - 1 },
    { pattern: /(\d+)\s*번째/,                                       resolve: (m) => parseInt(m[1], 10) - 1 },
    { pattern: /\blast\b|마지막|맨\s*마지막/i,                        resolve: () => -1 },
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
            'Supported actions: start, pause, resume, delete, list, clear.'
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
        .replace(/[,;!?]+/g, ' ')   // keep '.' so filenames like "ubuntu.iso" survive
        .replace(/멈추|멈춰|일시정지|중지|스톱|재개|계속|다시\s*시작|시작|삭제|지워|제거|취소|목록|리스트|보여|확인|알려|다운로드/g, '')
        .replace(/완료|정리|치워|완료된/g, '')
        .replace(/첫\s*번째?|두\s*번째|세\s*번째|\d+\s*번째|마지막|맨\s*마지막|맨\s*처음/g, '')
        .replace(/좀|줄래|줘|해줘|해|나|야|어제|받던|잠깐|싹\s*다|모두|전부|거|것|파일/g, '')
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
Parse the user's natural language input (English or Korean) into a structured IDM command.

Return a JSON object with exactly these fields:
- action: one of "start" | "pause" | "resume" | "delete" | "list" | "clear"
- target: filename or keyword to match (use "*" for all/wildcard)
- index: 0-based integer position if a specific position is mentioned, omit otherwise
  (Special: use -1 for "last")

"clear" removes ALL completed downloads from the queue — use it when the user asks to
clean up, clear completed, or remove finished items.

Few-shot examples:
Input: "list all downloads"
→ {"action":"list","target":"*"}

Input: "pause the first download"
→ {"action":"pause","target":"*","index":0}

Input: "resume ubuntu.iso"
→ {"action":"resume","target":"ubuntu.iso"}

Input: "delete the last item"
→ {"action":"delete","target":"*","index":-1}

Input: "start 3rd download"
→ {"action":"start","target":"*","index":2}

Input: "clear all completed downloads"
→ {"action":"clear","target":"*"}

Input: "야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?"
→ {"action":"pause","target":"우분투"}

Input: "다운로드 목록 좀 싹 다 보여줘"
→ {"action":"list","target":"*"}

Input: "맨 마지막에 받기 시작한 거 취소해"
→ {"action":"delete","target":"*","index":-1}

Input: "두 번째 파일 다시 시작해줘"
→ {"action":"resume","target":"*","index":1}

Input: "완료된 파일들 다 정리해줘"
→ {"action":"clear","target":"*"}`;

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

// ---------------------------------------------------------------------------
// Main entry point: LLM first, regex fallback
// ---------------------------------------------------------------------------

export async function parseCommand(text: string): Promise<IdmCommand> {
    if (!text.trim()) {
        throw new Error('Empty command. Try: "pause ubuntu.iso" or "list all downloads".');
    }

    try {
        const llmResult = await Promise.race([
            parseWithLLM(text),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);

        if (llmResult) return llmResult;

        if (!process.env['LLM_API_KEY']) {
            // Silent: no key configured, expected fallback
        } else {
            console.warn('[Agent Warning] LLM parsing failed or timed out. Falling back to Regex parser.');
        }
    } catch (err) {
        console.warn('[Agent Warning] LLM parsing failed. Falling back to Regex parser.', err instanceof Error ? err.message : err);
    }

    return parseNaturalLanguage(text);
}
