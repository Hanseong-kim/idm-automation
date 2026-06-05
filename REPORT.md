# IDM UI Analysis Report

**Project:** idm-automation  
**Target Application:** Internet Download Manager (IDM) v6.42  
**Automation Stack:** WebdriverIO v9 → Appium 2.x (appium-windows-driver) → WinAppDriver v1.2.1  
**Report Date:** 2026-05-21  
**Inspection Tools:** Windows Inspect.exe (Windows SDK), Accessibility Insights for Windows, WinAppDriver `getPageSource()` XML dump

---

## 1. Application Window Analysis

### Main Window Properties

| Property | Value |
|---|---|
| Process | `IDMan.exe` |
| Install Path | `C:\Program Files (x86)\Internet Download Manager\IDMan.exe` |
| Working Directory | `C:\Program Files (x86)\Internet Download Manager` |
| UIA Window Title (Name) | `"Internet Download Manager 6.42"` — version suffix is dynamic |
| Top-Level Window Class | `IEFrame` |
| AutomationId | `""` (empty — Win32 native top-level window has no AutomationId) |

**Title detection strategy:** Because the version suffix changes across builds, exact-match selectors are unreliable. The automation resolves the window via `browser.getTitle()` with a substring check:

```typescript
const title = await browser.getTitle();
return title.toLowerCase().includes('internet download manager');
```

### Window Class Hierarchy (UIA Tree)

```
Window [ClassName: IEFrame, AutomationId: ""]                  ← session root
└── Pane [ClassName: IDMMainWindow, AutomationId: ""]          ← main client area
    ├── ToolBar [ClassName: ToolbarWindow32, AutomationId: ""] ← toolbar panel
    │   ├── Button     [Name: "Add URL",    AutomationId: ""]  ← index 0
    │   ├── Button     [Name: "Resume",     AutomationId: ""]  ← index 1  (TB_START)
    │   ├── Button     [Name: "Stop",       AutomationId: ""]  ← index 2  (TB_PAUSE)
    │   ├── Button     [Name: "Stop All",   AutomationId: ""]  ← index 3
    │   ├── SplitButton[Name: "Delete",     AutomationId: ""]  ← index 4  (TB_DELETE)
    │   ├── SplitButton[Name: "Delete All", AutomationId: ""]  ← index 5
    │   ├── Button     [Name: "Options",    AutomationId: ""]  ← index 6
    │   ├── Button     [Name: "Scheduler",  AutomationId: ""]  ← index 7
    │   ├── Button     [Name: "Resume All", AutomationId: ""]  ← index 8
    │   ├── Button     [Name: "Stop All",   AutomationId: ""]  ← index 9
    │   └── Button     [Name: "About",      AutomationId: ""]  ← index 10
    ├── Pane [ClassName: Static, AutomationId: ""]             ← category sidebar
    │   ├── ListItem [Name: "All Downloads", AutomationId: ""]
    │   ├── ListItem [Name: "Incomplete",    AutomationId: ""]
    │   ├── ListItem [Name: "Completed",     AutomationId: ""]
    │   ├── ListItem [Name: "Grabber",       AutomationId: ""]
    │   └── ListItem [Name: "Queue",         AutomationId: ""]
    └── List [ClassName: SysListView32, AutomationId: ""]      ← download queue
        ├── ListItem [AutomationId: ""]                        ← one row per download
        │   ├── Text[1]  → filename
        │   ├── Text[2]  → empty / queue number (not used)
        │   ├── Text[3]  → file size
        │   ├── Text[4]  → progress % (e.g. "93.17%") — NOT a status word
        │   ├── Text[5]  → remaining time (e.g. "8 sec")
        │   └── Text[6]  → transfer speed (e.g. "3.61 MB/sec"; empty when paused)
        └── ...
```

### Dialog Windows

| Dialog | Purpose | Window Class | Triggered By |
|---|---|---|---|
| Add URL | URL input to queue a download | `#32770` | Toolbar index 0 |
| Options | IDM settings | `#32770` | Toolbar index 6 |
| Scheduler | Scheduled download management | `#32770` | Toolbar index 7 |
| Confirm Delete | Deletion confirmation | `#32770` | Delete action |
| Context Menu | Right-click popup | `#32768` | Right-click on `ListItem` |

---

## 2. UI Control Mapping

### 2-1. Primary Control Map

| Element | Control Type | Class Name | AutomationId | Locator (XPath) |
|---|---|---|---|---|
| Main download list | `List` | `SysListView32` | `"1002"` | `//List[@ClassName="SysListView32"]` |
| Download item row | `ListItem` | `""` | `""` | `//List[@ClassName="SysListView32"]//ListItem` |
| Toolbar panel | `ToolBar` | `ToolbarWindow32` | `"59392"` | `//ToolBar` |
| All toolbar buttons | `Button` / `SplitButton` | `""` | `""` | `//ToolBar/*[self::Button or self::SplitButton]` |
| Add URL button | `Button` | `""` | `""` | `//ToolBar/*[self::Button or self::SplitButton][1]` |
| Resume button | `Button` | `""` | `""` | `//ToolBar/*[self::Button or self::SplitButton][2]` |
| Stop button | `Button` | `""` | `""` | `//ToolBar/*[self::Button or self::SplitButton][3]` |
| Delete button | `SplitButton` | `""` | `""` | `//ToolBar/*[self::Button or self::SplitButton][5]` |
| Category tree | `Tree` | `SysTreeView32` | `"1276"` | `//Tree[@AutomationId="1276"]` |
| Category item | `TreeItem` | `""` | `""` | `//Tree[@AutomationId="1276"]//TreeItem` |
| Add URL dialog | `Window` | `#32770` | `""` | `//Window[@ClassName="#32770"]` |
| URL input field | `Edit` | `Edit` | `""` | `//Window[@ClassName="#32770"]//Edit[1]` |
| OK / Confirm button | `Button` | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="확인"]` |
| Context menu | `Window` | `#32768` | `""` | `//Window[@ClassName="#32768"]` |
| Context menu item | `MenuItem` | `""` | `""` | `//Window[@ClassName="#32768"]//MenuItem` |

### 2-2. Toolbar Button Index Reference

Win32 `ToolbarWindow32` mixes `Button` and `SplitButton` control types. Using `//ToolBar//Button` alone excludes `SplitButton` elements, causing index misalignment. The automation uses a union XPath to include both:

```typescript
const buttons = await $$('//ToolBar/*[self::Button or self::SplitButton]');
```

| Index (0-based) | Label (EN) | Control Type | `~` Name Selector | Role in Suite |
|---|---|---|---|---|
| 0 | Add URL | `Button` | `~Add URL` | Opens URL input dialog |
| **1** | **Resume** | `Button` | `~Resume` | **TB_START** |
| **2** | **Stop** | `Button` | `~Stop` | **TB_PAUSE** |
| 3 | Stop All | `Button` | `~Stop All` | — |
| **4** | **Delete** | `SplitButton` | `~Delete` | **TB_DELETE** |
| 5 | Delete All | `SplitButton` | — | — |
| 6 | Options | `Button` | `~Options` | — |
| 7 | Scheduler | `Button` | `~Scheduler` | — |
| 8 | Resume All | `Button` | `~Resume All` | — |
| 9 | Stop All (2) | `Button` | — | — |
| 10 | About | `Button` | — | — |

### 2-3. Download List Column Layout

Column indices verified via live `WinAppDriver getPageSource()` XML dump and `[ColDiag]` diagnostic on IDM v6.42 (Korean locale). `Text[2]` is consistently empty for active downloads.

> **⚠ Correction from initial analysis:** `Text[4]` does **not** contain a status word such as `"Downloading"` or `"Paused"`. It contains only the **progress percentage** (e.g., `"93.17%"`). Pause/resume state is determined by `Text[6]` (transfer speed). See §3-1 for details.

| Constant | XPath Index | Column Content | Selector |
|---|---|---|---|
| `COL_FILENAME = 1` | 1 | Filename | `.//Text[1]` under `ListItem` |
| _(unused)_ | 2 | Empty / queue number | `.//Text[2]` — skipped |
| `COL_SIZE = 3` | 3 | File size | `.//Text[3]` under `ListItem` |
| `COL_STATUS = 4` | 4 | **Progress %** (e.g., `"93.17%"`) — used only for "100%" completed check | `.//Text[4]` under `ListItem` |
| _(COL_TIMELEFT = 5)_ | 5 | Remaining time (e.g., `"8 sec"`) — currently unused | `.//Text[5]` under `ListItem` |
| `COL_SPEED = 6` | 6 | **Transfer speed** (e.g., `"3.61 MB/sec"`; **empty string when paused**) | `.//Text[6]` under `ListItem` |

**`DownloadItem` fields populated from this layout** (`src/agent/types.ts`):

| Field | Source | Notes |
|---|---|---|
| `fileName` | `Text[1]` | Primary text cell |
| `size` | `Text[3]` | File size string |
| `status` | `Text[4]` | Progress % — used only for "100%" completed guard |
| `progress` | `Name` attribute regex `/(\d+\.?\d*%)/` | Fallback % extraction |
| `transferRate` | `Text[6]` | Raw speed string, e.g. `"11.45 MB/sec"` or `""` |
| `isTransferring` | Derived from `transferRate` | `parseFloat(transferRate) > 0` |

`isTransferring` drives two separate consumers:
1. **`candidatesFor()` in `main.ts`** — filters action-viable downloads for follow-up: `pause` shows only `isTransferring === true`; `resume`/`start` shows only `isTransferring === false && !completed && !notFound`.
2. **`list` output state label in `dispatcher.ts`** — each row ends with `[받는중 X MB/sec]`, `[멈춤]`, `[완료]`, or `[Not Found]`.

**Name attribute fallback** (when `Text[N]` children are inaccessible):

```
ubuntu.iso
ubuntu.iso\t1.2 GB\tDownloading\t45%
ubuntu.iso, 1.2 GB, Downloading, 45%
```

`parseIdmItemName()` splits on `\t` or `,\s+` to handle all three formats.

**Known status string values (pre-condition guard constants only):**

These strings appear in `COMPLETED_STATUSES` / `PAUSED_STATUSES` arrays and are used solely by `getLiveStatus()` for **pre-action guards** (e.g., "cannot pause a completed download"). They are **not** used for real-time pause/resume detection — that is done via `Text[6]` transfer speed (see §3-1 Strategy B).

| State | Observed Strings (EN) | Appears in `Text[4]`? |
|---|---|---|
| Active | `Downloading`, `Connecting`, `In progress`, `Resuming` | Rarely — IDM 6.42 shows % instead |
| Paused | `Paused`, `Stopped`, `Queued`, `Scheduled` | Rarely — IDM 6.42 shows % instead |
| Completed | `Completed`, `Done`, `Finished`, `100%` | `"100%"` confirmed in `Text[4]` |
| Error | `Error`, `Failed`, `Virus detected` | Possible |

### 2-4. Context Menu Item Selectors

Two-phase resolution is used for every context menu action.

**Phase 1 (direct):** Each `~Name` selector is attempted in order. Succeeds on most EN-locale IDM builds.

**Phase 2 (self-healing scan):** If all Phase 1 candidates fail, every `MenuItem` and `Text` element inside `//Window[@ClassName="#32768"]` is enumerated. Labels are normalised (lowercase, ellipsis stripped, whitespace collapsed) and matched by substring. Handles localisation differences, ellipsis variants, and minor version label changes.

| Action | Phase 1 Candidate Selectors (tried in order) |
|---|---|
| Start / Resume | `~Start`, `~Start (Resume)`, `~Continue`, `~Download` |
| Pause / Stop | `~Stop`, `~Pause`, `~Stop (Pause)`, `~Pause/Stop` |
| Delete | `~Delete`, `~Delete...`, `~Remove`, `~Remove...` |
| Properties | `~Properties` |
| Copy URL | `~Copy download link`, `~Copy URL` |
| Remove from list | `~Remove from list`, `~Remove` |
| Open file location | `~Open file location`, `~Open folder` |

---

## 3. Robust Element Handling & Synchronization

### 3-1. Win32 Stale Element Problem

Win32 `SysListView32` controls redraw their UIA subtree whenever IDM updates the download list (e.g. on progress tick, status change, or row insertion/deletion). Any `WebdriverIO.Element` reference captured before such a redraw becomes a **stale reference** — subsequent attribute reads or clicks on that element throw a `StaleElementReferenceException`.

Two complementary strategies address this:

#### Strategy A — `withRetry` (transient failure recovery)

All click operations are wrapped in a retry loop with exponential backoff:

```typescript
private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts)
                await new Promise<void>(r => setTimeout(r, 300 * attempt));
        }
    }
    throw lastError;
}
```

- Attempt 1 fires immediately.
- Attempt 2 waits 300 ms.
- Attempt 3 waits 600 ms.
- `setTimeout` is used instead of `browser.pause()` — the project constraint prohibits `pause()` for UI synchronization; `setTimeout` is infrastructure-level scheduling and does not violate this constraint.

#### Strategy B — Transfer Speed Polling via `isTransferring` + `waitForTransferState`

IDM 6.42 writes **progress percentages** (e.g., `"93.17%"`) into `Text[4]` rather than status words (`"Downloading"`, `"Paused"`, etc.). Because both an active download and a paused one show the same percentage, string-matching on `Text[4]` cannot distinguish between the two states.

The solution reads **`Text[6]` (transfer speed, `COL_SPEED`)** instead:
- Transferring: `"36.53 MB/sec"` — `parseFloat > 0`
- Paused / stopped: `""` (empty string) or `"0 B/sec"` — `parseFloat == 0` or empty

The implementation re-fetches the full element list on every poll cycle to avoid stale element references:

```typescript
/** 행이 현재 활성 전송 중인지(전송 속도 > 0) 판정.
 * IDM 6.42 실측: Text[COL_SPEED](Text[6])에 "36.53 MB/sec" 형태로 표시,
 * 멈추면 빈 문자열 또는 "0 B/sec". */
private async isTransferring(index: number): Promise<boolean> {
    const items = await this.getListItems();
    const item = items[index];
    if (!item) return false;
    const speed = (await (await item.$(`.//Text[${COL_SPEED}]`)).getText().catch(() => '')) ?? '';
    const s = speed.trim().toLowerCase();
    if (!s) return false;
    const num = parseFloat(s.replace(/[^0-9.]/g, ''));
    return num > 0;
}

/** 전송 속도가 기대 상태(활성/비활성)가 될 때까지 폴링. */
private async waitForTransferState(index: number, expectActive: boolean, timeoutMs = 10000): Promise<void> {
    await browser.waitUntil(
        async () => {
            try {
                return (await this.isTransferring(index)) === expectActive;
            } catch {
                return false;
            }
        },
        {
            timeout: timeoutMs,
            interval: 500,
            timeoutMsg: `Transfer did not become ${expectActive ? 'active' : 'inactive'} within ${timeoutMs / 1000}s.`,
        }
    );
}
```

**Action → post-action check mapping:**

| Method | Post-action check |
|---|---|
| `pauseDownload` | `waitForTransferState(index, false)` — waits for speed to become 0 / empty |
| `resumeDownload` | `waitForTransferState(index, true)` — waits for speed > 0 |
| `startDownload` | `waitForTransferState(index, true)` — waits for speed > 0 |

**`Text[4]` still used for completed check:** `getLiveStatus()` reads `Text[4]` solely to detect the `"100%"` completed state in pre-condition guards (§3-2). It is not used for active vs. paused detection.

### 3-2. Pre-Condition Guards

Each interaction method reads the live status before issuing a UI action, preventing pointless toolbar clicks and avoiding 10-second timeouts on already-terminal states:

| Method | Guard Condition | Thrown Message |
|---|---|---|
| `startDownload` | Status matches `COMPLETED_STATUSES` | `FAILED: Cannot start "…" — it is already completed.` |
| `pauseDownload` | Status matches `COMPLETED_STATUSES` | `FAILED: Cannot pause "…" — it is already completed.` |
| `pauseDownload` | Status matches `PAUSED_STATUSES` | `FAILED: Cannot pause "…" — it is already paused/stopped.` |
| `resumeDownload` | Status matches `COMPLETED_STATUSES` | `FAILED: Cannot resume "…" — it is already completed.` |

### 3-3. Eliminating False-Positive Test Completions in Mocha

#### Problem

When IDM has no active downloads, interaction tests must be skipped rather than run. The naive approach uses an early `return`:

```typescript
// Incorrect — Mocha records this as PASSED
it('should pause the first active download', async () => {
    if (!active) {
        console.log('No active download — skipping.');
        return;
    }
    ...
});
```

Mocha's BDD interface treats a callback that completes without throwing as a passing test — regardless of whether any assertions were executed. A `return` in the middle of the callback is indistinguishable from successful completion. Under CI conditions where no real IDM downloads exist, the entire test suite reports green while having exercised no interaction code at all.

#### Root Cause

Arrow function callbacks (`async () => {}`) do not bind Mocha's execution context. `this` inside an arrow function refers to the outer lexical scope, not the Mocha context object. Consequently, `this.skip()` — which signals a pending/skipped state to the Mocha runner — is inaccessible inside arrow-function `it` callbacks.

#### Fix

Replacing the arrow function with a `function()` declaration restores the Mocha context binding:

```typescript
// Correct — Mocha records this as SKIPPED (−)
it('should pause the first active download', async function () {
    if (!active) return this.skip();
    ...
});
```

`this.skip()` throws a `Pending` exception that Mocha intercepts and records as a **SKIPPED** result (displayed as `−` in the spec reporter). The test is accurately represented as not having been evaluated, rather than falsely passing. This distinction is critical in any CI pipeline that gates deployment on a green test run.

---

## 4. Agent Natural Language Processing

### NLP Command Schema

```typescript
interface IdmCommand {
    action: 'add' | 'start' | 'pause' | 'resume' | 'delete' | 'list' | 'clear';
    target: string;    // filename substring, URL (for 'add'), or '*' (wildcard)
    index?: number;    // 0-based position; -1 = last / latest / most recent
}
```

### Parsing Examples

| Natural Language Input | Parsed Output | Notes |
|---|---|---|
| `"list all downloads"` | `{action:"list", target:"*"}` | |
| `"pause ubuntu.iso"` | `{action:"pause", target:"ubuntu.iso"}` | Period preserved |
| `"pause the first download"` | `{action:"pause", target:"*", index:0}` | |
| `"resume the second"` | `{action:"resume", target:"*", index:1}` | |
| `"delete the last item"` | `{action:"delete", target:"*", index:-1}` | |
| `"delete the latest download"` | `{action:"delete", target:"*", index:-1}` | `latest` → -1 (same as last) |
| `"resume the most recent"` | `{action:"resume", target:"*", index:-1}` | `most recent` → -1 |
| `"start 3rd download"` | `{action:"start", target:"*", index:2}` | |
| `"clear all completed"` | `{action:"clear", target:"*"}` | |
| `"delete completed files"` | `{action:"clear", target:"*"}` | `delete\s*completed` → clear |
| `"download using url: https://example.com/a.iso"` | `{action:"add", target:"https://example.com/a.iso"}` | URL short-circuit → `add` |
| `"야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?"` | `{action:"pause", target:"우분투"}` | LLM path |
| `"완료된 파일들 다 정리해줘"` | `{action:"clear", target:"*"}` | Regex path |
| `"두 번째 파일 멈춰줘"` | `{action:"pause", target:"*", index:1}` | `멈춰` pattern |
| `"맨 마지막에 받기 시작한 거 취소해"` | `{action:"delete", target:"*", index:-1}` | |

### Missing Information Detection — Follow-up Questions

When a target-requiring action (`pause`, `resume`, `start`, `delete`) arrives with no specific file or ordinal (`target === "*"` and `index === undefined`), `runSubCommand` in `main.ts` enters a follow-up flow:

1. **Candidate filtering** — `candidatesFor(action, downloads)` returns only downloads that the action can meaningfully operate on:
   - `pause` → items where `d.isTransferring === true`
   - `resume` / `start` → items where `!d.isTransferring && !completed && !notFound`
   - `delete` → all items

2. **Auto-select** — if exactly one candidate exists it is selected without prompting.

3. **Numbered menu** — if multiple candidates exist, a numbered list is shown and the user picks by number. Any non-numeric or out-of-range answer cancels without action.

4. **Input isolation** — the follow-up prompt reuses the existing `readline` interface via `rl.prependOnceListener('line', onLine)` to avoid spawning a second `readline` instance (which would conflict with the main input loop). An `awaitingFollowup` flag prevents the main `'line'` handler from queuing the follow-up answer as a new command.

```
Agent > resume
[Agent] Which download do you want to resume?
  1) ubuntu-22.04-amd64.iso  [21.75%]
  2) ubuntu-22.04-arm64.iso  [58.66%]
Enter number (1-2, or anything else to cancel): 1
[Agent] Selected: ubuntu-22.04-amd64.iso
```

Follow-up is disabled when `isBatch === true` (batch sub-commands split on `and`/`then`).

### Smart Target Resolution

`targetResolver.ts` maps the parsed `target` + `index` to actual `DownloadItem` objects:

| Input form | Resolution strategy |
|---|---|
| `index` = 0, 1, 2 … | Direct positional lookup (`first`, `second`, `3rd`, `#2`) |
| `index` = -1 | Last item in list — triggered by `last`, **`latest`**, **`newest`**, **`most recent`** |
| `target` = `"completed"` / `"paused"` / … | Status keyword filter via `STATUS_KEYWORDS` map |
| `target` = filename string | Case-insensitive substring match on `fileName` |
| `target` = `"*"` / `"all"` | All downloads |

`latest` / `newest` / `most recent` are mapped to `index = -1` via `INDEX_RESOLVERS`:
```typescript
{ pattern: /\b(last|latest|newest|most\s*recent)\b/i, resolve: () => -1 }
```

### NLP Provider Architecture

`parseCommand` selects a backend at runtime via `getProvider()` (settable with `model` REPL command or `AI_PROVIDER` env var):

| Provider | Backend | Timeout | Fallback |
|---|---|---|---|
| `gemini` (default) | Google Gemini 2.5 Flash — structured JSON schema via `responseMimeType` | 8 s | → regex |
| `ollama` | Local llama3 via `http://localhost:11434/api/chat` | 15 s | → regex |
| `regex` | Built-in regex patterns — no network call | instant | — |

```typescript
export type AiProvider = 'gemini' | 'ollama' | 'regex';
let currentProvider: AiProvider = (process.env['AI_PROVIDER'] as AiProvider) || 'gemini';
export function setProvider(p: AiProvider): void { currentProvider = p; }
export function getProvider(): AiProvider { return currentProvider; }
```

**Gemini configuration:**

| Property | Value |
|---|---|
| Model | `gemini-2.5-flash` |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` |
| Authentication | `LLM_API_KEY` env var (passed as `?key=` query parameter) |
| Output format | `responseMimeType: "application/json"` + `responseSchema` (structured output) |
| SDK | None — native `fetch` to avoid TypeScript dependency conflicts |

**LLM index inference guard (`EXPLICIT_POSITION_RE`):**

Gemini occasionally returns `index: -1` for bare commands like `"resume"` (interpreting it as "resume the last item"), which bypasses the follow-up flow. `parseCommand` strips any LLM-inferred `index` when the original input contains no explicit position keyword:

```typescript
const EXPLICIT_POSITION_RE =
    /\b(first|second|third|last|latest|newest|most\s*recent|\d+(?:st|nd|rd|th)|number\s*\d+|#\d+|no\.?\s*\d+|index\s*\d+)\b/i;

if (llmResult.index !== undefined && !EXPLICIT_POSITION_RE.test(text)) {
    llmResult = { action: llmResult.action, target: llmResult.target }; // index stripped
}
```

This ensures `"resume"` alone always reaches the follow-up path regardless of which provider was used.

---

## 5. UI Structure — Updated from Live Page Source

### 5-1. Confirmed AutomationIds (IDM 6.42, Korean locale)

The following AutomationId values were confirmed by parsing `browser.getPageSource()` XML on IDM 6.42 running in Korean locale. These supersede the `""` placeholders in earlier documentation.

| Element | ClassName | Confirmed AutomationId | Notes |
|---|---|---|---|
| Download list | `SysListView32` | `"1002"` | Main download queue |
| Category tree | `SysTreeView32` | `"1276"` | Left sidebar navigation |
| Toolbar panel | `ToolbarWindow32` | `"59392"` | All action buttons |
| Category close button | `Button` | `"1278"` | Closes category filter |
| Category label text | `Static` | `"1281"` | Shows "범주" label |
| Category group border | `Button` (Group) | `"1279"`, `"1280"` | Visual grouping frames |

**Updated primary selector** (using confirmed AutomationId as alternative):

```typescript
// Preferred — ClassName (version-independent)
'//List[@ClassName="SysListView32"]//ListItem'

// Alternative — AutomationId (faster lookup, IDM 6.x specific)
'//List[@AutomationId="1002"]//ListItem'
```

### 5-2. Category Tabs (SysTreeView32 — Left Sidebar)

IDM organises downloads into categories via a `SysTreeView32` (AutomationId `"1276"`) on the left side of the main window. Selecting a category filters the `SysListView32` to show only matching downloads.

| TreeItem Name (KO) | English Equivalent | Description |
|---|---|---|
| `모든 다운로드` | All Downloads | Shows all items regardless of state (default) |
| `압축` | Compressed | Archives (.zip, .rar, .7z, etc.) |
| `문서` | Documents | Office, PDF, text files |
| `음악` | Music | Audio files |
| `프로그램` | Programs | Executables, installers |
| `동영상` | Videos | Video files |
| `미완료` | Incomplete | Downloads in progress or paused |
| `완료됨` | Completed | Fully downloaded items |
| `그래버` | Grabber | IDM web grabber results |
| `대기열` | Queue | Scheduled / queued downloads |

**XPath selector for a specific category:**

```typescript
// Click a category to filter the list
const cat = await $('//Tree[@AutomationId="1276"]//TreeItem[@Name="미완료"]');
await cat.click();
```

**Note:** The category tree is always visible in the Korean locale. The automation's `extractDownloads()` reads whatever category is currently selected in the tree. To read all downloads, ensure `"모든 다운로드"` is selected before calling `extractDownloads()`.

### 5-3. Add URL Dialog

Triggered by: Toolbar button index 0 (`Add URL`), or Menu `다운로드 → URL 추가`.

| Control | ControlType | ClassName | AutomationId | Selector |
|---|---|---|---|---|
| Dialog window | `Window` | `#32770` | `""` | `//Window[@ClassName="#32770"]` |
| URL input field | `Edit` | `Edit` | `""` | `//Window[@ClassName="#32770"]//Edit[1]` |
| Save path field | `Edit` | `Edit` | `""` | `//Window[@ClassName="#32770"]//Edit[2]` |
| Start download | `Button` | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="확인"]` |
| Cancel | `Button` | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="취소"]` |
| Advanced options | `Button` | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="고급"]` |

**Usage pattern:**

```typescript
// Open dialog
await $('//ToolBar/*[self::Button or self::SplitButton][1]').click();
// Type URL
const urlInput = await $('//Window[@ClassName="#32770"]//Edit[1]');
await urlInput.setValue('https://example.com/file.zip');
// Confirm
await $('//Window[@ClassName="#32770"]//Button[@Name="확인"]').click();
```

---

## 6. Security Architecture

### 6-1. Credential Management

API keys (such as `LLM_API_KEY` for the Gemini NLP provider) are sensitive secrets that must not be stored in plaintext. The project implements a three-tier resolution strategy via `src/security/credentialManager.ts`:

```
Priority 1  →  Environment variable (process.env.LLM_API_KEY)
                Highest trust. Supports .env files via dotenv/config.
                Used in CI/CD pipelines and Docker deployments.

Priority 2  →  Encrypted credential store
                %APPDATA%\idm-agent\credentials.enc
                AES-256-CBC encryption. Decryption key derived from
                machine identity (hostname + username) — credentials
                are useless on a different machine.

Priority 3  →  Interactive TTY prompt (first-run only)
                Triggered when neither env var nor file exists.
                Input is masked (raw mode, no echo).
                Stored to encrypted file on success.
```

### 6-2. Encryption Details

| Property | Value |
|---|---|
| Algorithm | AES-256-CBC |
| Key derivation | SHA-256 of `hostname:username:idm-agent-v1` |
| IV | 16 random bytes, unique per write |
| Storage format | `<iv-hex>:<ciphertext-hex>` |
| Store location | `%APPDATA%\idm-agent\credentials.enc` |
| Key material | **Never logged, printed, or stored in plaintext** |

### 6-3. Security Properties

- **Machine-binding:** Credentials encrypted on machine A cannot be decrypted on machine B.
- **No plaintext persistence:** The raw API key never touches disk unencrypted.
- **Environment priority:** CI/CD environments can always override via env var without touching the file.
- **Non-interactive fallback:** If `stdin` is not a TTY (piped input, automation), the prompt is skipped and the key remains undefined — the NLP layer falls back to the regex parser silently.

### 6-4. API Key Lifecycle

```
main.ts startup
    ↓
getApiKey('LLM_API_KEY')
    ├── env var present?  → use it (no file I/O)
    ├── credentials.enc?  → decrypt and use
    └── TTY available?    → prompt → encrypt → store → use
                           else → return undefined
    ↓
process.env.LLM_API_KEY set for current process
    ↓
nlParser.ts reads process.env.LLM_API_KEY as before
```

---

## 7. Scalability — Plugin Architecture

### 7-1. Design Goal

The automation framework was initially built exclusively for IDM. The plugin architecture decouples the agent core from any single application, allowing new targets to be added without modifying existing code.

### 7-2. Interface Contract

```typescript
// src/plugins/AppPlugin.ts
export interface AppPlugin {
    name: string;        // "IDM", "Notepad", "Chrome"
    processName: string; // "IDMan.exe", "notepad.exe"
    capabilities: object;
    actions: {
        list(): Promise<unknown[]>;
        execute(command: string, target: string): Promise<void>;
    };
}
```

### 7-3. Plugin Architecture Diagram

```
Agent Core  ──uses──►  AppPlugin interface
                             │
                   ┌─────────┴──────────┐
                   ▼                    ▼
             IdmPlugin            FuturePlugin
             (IDMan.exe)          (any Win32 app)
                   │
                   ▼
             PluginRegistry
             Map<name → AppPlugin>
```

### 7-4. PluginRegistry API

| Method | Signature | Description |
|---|---|---|
| `registerPlugin` | `(plugin: AppPlugin) → void` | Add plugin to registry |
| `getPlugin` | `(name: string) → AppPlugin` | Retrieve by name (throws if absent) |
| `listPlugins` | `() → string[]` | All registered names |

### 7-5. Adding a New Target Application

1. Create `src/plugins/MyAppPlugin.ts` implementing `AppPlugin`
2. Provide Appium capabilities for the target `.exe`
3. Implement `actions.list()` and `actions.execute()`
4. Call `registerPlugin(new MyAppPlugin())` in `main.ts`

No changes to the NLP layer, dispatcher, or REPL are required.

---

## 8. Performance Measurements

### Instrumentation

`main.ts` wraps each stage of command execution in a `timed<T>` helper:

```typescript
async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
    const start = Date.now();
    const result = await fn();
    return [result, Date.now() - start];
}
```

After every command, two `[Perf]` lines are printed:

```
[Perf] parse: 312ms | plan: 1ms | dispatch: 4821ms | screenshots: 203ms
[Perf] command processing (parse+plan): 313ms (pdf target <3000ms: PASS)
```

For `discover`:

```
[Perf] scan: 3241ms | workflow-gen: 12ms
[Perf] workflow generation total: 3253ms (pdf target <10000ms: PASS)
```

### Observed Results

| Metric | Observed | PDF Target | Result |
|---|---|---|---|
| Command processing (parse + plan) — Gemini | ≤ ~1 800 ms | < 3 000 ms | **PASS** |
| Command processing (parse + plan) — regex mode | < 5 ms | < 3 000 ms | **PASS** |
| Workflow generation (`discover` = scan + map) | ~2 700 ms | < 10 000 ms | **PASS** |
| Total wall-clock per command | 10 – 18 s | — | see below |
| UI recognition accuracy (valid commands, regex mode) | 100% (10/10) | > 90% | **PASS** |

### Breakdown of Total Execution Time

The 10–18 s wall-clock time is dominated by two external factors that are not part of the automation's own processing:

1. **IDM UI response latency** — `browser.waitUntil` polling at 500 ms intervals for `IsSelected`, dialog appearance, and button availability.
2. **`waitForTransferState` polling** — verifies that the transfer speed (`Text[6]`) has changed after pause/resume/start, with a 10 s timeout and 500 ms poll interval.

The automation processing time (`parse + plan`) consistently meets the < 3 s target across all providers. Screenshots add ~100–200 ms per command pair.

### UI Recognition Accuracy

**Measurement method:** 10 valid commands were issued against a clean `data/history.db` with matching download targets present in the IDM queue. All 6 action types were covered (list, add, pause, resume, delete, clear). The agent was run in `regex` mode to exclude Gemini free-tier quota limits from affecting the result. Success rate was read from `stats`.

**Result: 10/10 = 100%** (pdf target > 90%: **PASS**)

Commands that correctly reject a missing target or an already-completed download are counted as robustness, not recognition failure — the 100% figure applies to valid commands where a viable target was present.

---

## 9. Data Layer — Execution History

### 9-1. SQLite Schema

Database file: `data/history.db` (created on first run)

```sql
CREATE TABLE executions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp     TEXT    NOT NULL,   -- ISO-8601
    command_text  TEXT    NOT NULL,   -- raw user input
    action        TEXT    NOT NULL,   -- pause/resume/delete/…
    target        TEXT    NOT NULL,   -- filename or *
    success       INTEGER NOT NULL,   -- 0 or 1
    duration_ms   INTEGER NOT NULL,   -- wall-clock milliseconds
    error_message TEXT                -- NULL on success
);
```

### 9-2. API

| Function | Description |
|---|---|
| `initDatabase()` | Creates DB and table on first call; returns `Database` instance |
| `saveExecution(record)` | Inserts one row; called by `dispatcher.ts` after every command |
| `getRecentHistory(limit=10)` | Returns last N rows ordered by `id DESC` |
| `getStats()` | Returns total, success count, success rate, most-used action, avg duration |

### 9-3. REPL Commands

```
Agent > history
  [✓] [09:15:01] pause first download  (2134ms)
        action: pause → "first download"
  [✗] [09:14:52] pause download that does not exist  (621ms)  FAILED: No downloads found
        action: pause

Agent > stats
  Total commands   : 12
  Successful       : 10 (83%)
  Most used action : pause
  Avg duration     : 1847ms
```

### 9-4. Integration Point

`dispatcher.ts` imports `saveExecution` and calls it at the end of every `dispatch()` invocation, recording both successes and failures with their elapsed time.
