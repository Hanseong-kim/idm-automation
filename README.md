# IDM Desktop Automation + Agentic AI System

A Windows desktop UI automation framework targeting **Internet Download Manager (IDM) v6.x**, paired with a natural-language agentic layer that converts English and Korean commands into executable IDM actions.

The automation stack operates as a three-tier bridge:

```
WebdriverIO v9 (W3C)  →  Appium 2.x :4724 (JSONWP proxy)  →  WinAppDriver v1.2.1 (Win32 UIA)
```

WinAppDriver v1.2.1 rejects the W3C WebDriver protocol natively; Appium 2.x acts as the translation layer, converting W3C requests into JSONWP before forwarding to WinAppDriver.

---

## 🧰 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Test Runner | WebdriverIO | ^9.27.1 |
| Language | TypeScript (strict mode) | ^5.8.3 |
| TS Executor | tsx | ^4.19.4 |
| Desktop Bridge | Appium + appium-windows-driver | 2.x |
| WinAPI Driver | WinAppDriver | 1.2.1 |
| Test Framework | Mocha (`@wdio/mocha-framework`) | ^9.27.1 |
| Assertions | expect-webdriverio | ^5.6.5 |
| LLM Provider | Google Gemini 2.5 Flash | API v1beta |
| Runtime | Node.js | ≥ 18 |

**TypeScript compiler flags enforced:**

```json
"strict": true,
"noUnusedLocals": true,
"noUnusedParameters": true,
"noFallthroughCasesInSwitch": true
```

---

## 📦 Setup & Installation

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Windows | 10 / 11 64-bit | |
| Node.js | ≥ 18 | Verify with `node -v` |
| Internet Download Manager | 6.x | Installed at default path |
| WinAppDriver | 1.2.1 | Must be running as Administrator on port 4723 |
| Appium | 2.x | Globally installed; listens on port 4724 |

### Install

```powershell
# Step 1 — Install Appium globally (one-time)
npm install -g appium

# Step 2 — Install the Appium Windows driver (one-time)
appium driver install windows

# Step 3 — Install project dependencies
npm install
```

### Environment Variables

Create a `.env` file in the project root (optional — only required for LLM-enhanced parsing):

```env
LLM_API_KEY=your_google_ai_studio_key_here
```

Obtain a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).

> If `LLM_API_KEY` is absent or the Gemini API is unreachable, the agent automatically
> falls back to the built-in Regex parser. All core functionality operates without a key.

---

## 🏃 How to Run

### Automated Test Suite

```powershell
npm run wdio
```

- `@wdio/appium-service` automatically starts and stops Appium on port 4724 around the test run.
- WinAppDriver must already be running as Administrator.
- IDM must be open. If the download queue is empty, interaction tests are marked **SKIPPED (−)** — not PASSED — ensuring zero false-positives.

**Expected output with an empty queue:**

```
NL Parser — unit tests
  ✓ parses "list all downloads"
  ✓ parses "pause the first download"
  ✓ parses "resume ubuntu.iso"
  ✓ parses "delete the last item"
  ✓ parses "start 3rd download"
  ✓ parses "delete completed files" as clear
  ✓ parses "show me all downloads" as list
  ✓ parses "pause number 2"
  ✓ throws on unrecognised action
  ✓ throws on empty input

IDM Agent — NL command execution
  ✓ should list all downloads via natural language
  - should pause the first download via natural language      (skipped)
  - should resume the first paused download via natural language  (skipped)
  ✓ should handle an unknown filename gracefully

LLM Parser — parseCommand unit tests
  ✓ parses Korean conversational pause
  ✓ parses Korean list command
  ✓ parses Korean delete-last
  ✓ parses Korean resume-second
  ✓ parses conversational English
  ✓ parses implicit list
  ✓ throws on empty input even with LLM path

IDM — UI Automation
  ✓ should launch IDM and verify the main window is accessible
  ✓ should extract downloads and print structured data
  - should pause the first active download    (skipped)
  - should resume the first paused download   (skipped)
  - should start the first queued download    (skipped)

Spec Files: 2 passed, 2 total
```

### Agent REPL (Interactive CLI)

```powershell
npm run start:agent
```

Establishes an Appium session against IDM and enters an interactive natural-language command loop.

**Sample session:**

```
Agent > list all downloads
[Result] ✓ Listed 3 download(s).

Agent > pause ubuntu.iso
[AI Intent] Action: pause, Target: ubuntu.iso
[Result] ✓ "ubuntu.iso" paused successfully.

Agent > pause first download and delete the last
[Batch] → "pause first download"
[Result] ✓ "ubuntu.iso" paused successfully.
[Batch] → "delete the last"
[Result] ✓ "debian.iso" deleted successfully.

Agent > undo
[Agent] Cannot undo "delete" — this action is irreversible.

Agent > repeat
[Agent] Repeating: pause "ubuntu.iso"
[Result] ✓ "ubuntu.iso" paused successfully.

Agent > exit
```

**Supported commands:**

| Type | English Example | Korean Example |
|---|---|---|
| List | `list all downloads` | `다운로드 목록 보여줘` |
| Pause | `pause ubuntu.iso` | `우분투 파일 멈춰줘` |
| Resume | `resume the second download` | `두 번째 파일 다시 시작해줘` |
| Start | `start first download` | `첫 번째 다운로드 시작해` |
| Delete | `delete the last item` | `맨 마지막 꺼 취소해` |
| Clear completed | `clear all completed` | `완료된 파일들 다 정리해줘` |
| Repeat | `repeat` / `do it again` | — |
| Undo | `undo` (pause↔resume, start→pause) | — |
| Batch | `pause first and delete the second` | — |

---

## 🤖 Agentic AI Architecture & Hybrid Fail-Safe

### Multi-Tier Parsing Pipeline

```
User Input (EN / KO)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│                   parseCommand(text)                    │
│                                                         │
│   ┌──────────────────────────────────┐                  │
│   │        Gemini 2.5 Flash          │ ← LLM_API_KEY   │
│   │  Structured JSON via responseSchema               │
│   │  HTTP POST, 8-second race timeout │                 │
│   └─────────────────┬────────────────┘                  │
│                     │  failure / timeout / no key       │
│                     ▼                                   │
│   ┌──────────────────────────────────┐                  │
│   │      Regex Fallback Parser       │ ← always active  │
│   │   parseNaturalLanguage(text)     │                  │
│   └──────────────────────────────────┘                  │
└─────────────────────────────────────────────────────────┘
        │
        ▼
  IdmCommand { action, target, index? }
        │
        ▼
  resolveTarget()  →  DownloadItem[]
        │
        ▼
  IdmPage interaction method
        │
        ▼
  waitForStatusChange()  →  CommandResult { success, message }
```

### Hybrid Fail-Safe Fallback Mechanism

The Gemini API Free Tier enforces a limit of **5 requests per minute**. Under sustained load, the API returns HTTP `429 (Quota Exceeded)` or `503 (Unavailable)`. Without a fallback, these errors would cause a complete agent blackout.

The system prevents this via a `Promise.race` guard with a deterministic Regex fallback:

```typescript
// src/agent/nlParser.ts
const llmResult = await Promise.race([
    parseWithLLM(text),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
]);

if (llmResult) return llmResult;       // LLM succeeded
return parseNaturalLanguage(text);     // All failure paths → Regex parser
```

| Failure Condition | Behaviour |
|---|---|
| `LLM_API_KEY` not set | LLM call skipped entirely; Regex parser invoked immediately |
| HTTP 429 — Quota Exceeded | Warning logged; stream diverted to Regex parser |
| HTTP 503 — Service Unavailable | Warning logged; stream diverted to Regex parser |
| 8-second timeout | `Promise.race` resolves `null`; Regex parser invoked |
| LLM JSON schema mismatch | `isValidIdmCommand()` returns false; Regex parser invoked |

The Regex parser covers all primary command patterns in both English and Korean, including colloquial forms (`멈춰`, `취소해`, `정리해줘`), ordinal positions (`first`, `두 번째`, `last`), and compound constructs. **The agent never halts due to LLM unavailability.**

### Command Schema

```typescript
// src/agent/types.ts
interface IdmCommand {
    action: 'start' | 'pause' | 'resume' | 'delete' | 'list' | 'clear';
    target: string;    // filename substring or '*' (wildcard)
    index?: number;    // 0-based position; -1 = last
}
```

### Smart Target Resolution

```
resolveTarget(target, downloads, index?)  →  DownloadItem[]
```

| Priority | Strategy | Input Example | Resolution |
|---|---|---|---|
| 1 | Explicit index | `"first"`, `"3rd"`, `"last"` | `index=0`, `index=2`, `index=-1` |
| 2 | Wildcard | `target="*"` | Returns full `downloads[]` |
| 3 | Status filter | `target="completed"` | Filters by `status` field |
| 4 | Filename substring | `target="ubuntu"` | Matches `"ubuntu.iso"` |

### Command Memory

```typescript
// src/main.ts
const commandHistory: IdmCommand[] = [];

const UNDO_MAP: Partial<Record<ActionType, ActionType>> = {
    pause: 'resume',
    resume: 'pause',
    start: 'pause',
};
```

- **`repeat`**: Re-executes the last successfully dispatched command.
- **`undo`**: Executes the logical inverse via `UNDO_MAP`. `delete`, `clear`, and `list` are irreversible.
- **Batch execution**: Input is split on `\s+(?:and|then)\s+`; sub-commands run sequentially. A failure in one sub-command does not abort the remainder.

---

## 🗂️ Project Structure

```
idm-automation/
├── src/
│   ├── main.ts                  ← Agent REPL entry point (batch / memory / undo)
│   └── agent/
│       ├── types.ts             ← IdmCommand, DownloadItem, CommandResult interfaces
│       ├── nlParser.ts          ← Gemini LLM + Regex dual-parser
│       ├── dispatcher.ts        ← IdmCommand → IdmPage function dispatcher
│       └── targetResolver.ts    ← Smart target resolution (index / status / filename)
├── test/
│   ├── pageobjects/
│   │   └── IdmPage.ts           ← IDM Win32 UIA Page Object (all interactions)
│   └── specs/
│       ├── test.e2e.ts          ← UI automation layer tests (Tasks 3–5)
│       └── agent.e2e.ts         ← Agent layer tests (Tasks 9–14)
├── wdio.conf.ts                 ← WebdriverIO + Appium session configuration
├── tsconfig.json                ← TypeScript strict configuration
├── package.json
└── REPORT.md                    ← IDM UI analysis report (Tasks 1–2)
```

---

## ⚙️ Configuration Reference

### Appium Capabilities (`wdio.conf.ts`)

```typescript
capabilities: [{
    platformName: 'Windows',
    'appium:automationName': 'Windows',
    'appium:app': 'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe',
    'appium:appWorkingDir': 'C:\\Program Files (x86)\\Internet Download Manager',
    'appium:newCommandTimeout': 3600,
} as WebdriverIO.Capabilities]
```

### Design Constraints

| Constraint | Implementation |
|---|---|
| No `browser.pause()` | All UI synchronization uses `browser.waitUntil()` exclusively |
| No coordinate-based clicks | All element targeting via XPath or UIA Name attribute |
| Preserve file extensions | `extractTarget()` does not strip `.` — `ubuntu.iso` is preserved as-is |
| Stale element resilience | `withRetry(maxAttempts=3)` with exponential backoff on all click paths |
| Live status polling | `getLiveStatus(index)` re-fetches the full element list on every `waitUntil` cycle |
