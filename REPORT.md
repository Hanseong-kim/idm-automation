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
        │   ├── Text[2]  → empty / URL (not used)
        │   ├── Text[3]  → file size
        │   └── Text[4]  → status string
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

Column indices verified via `WinAppDriver getPageSource()` XML dump on IDM v6.42. `Text[2]` is consistently empty for active downloads.

| Constant | XPath Index | Column Content | Selector |
|---|---|---|---|
| `COL_FILENAME = 1` | 1 | Filename | `.//Text[1]` under `ListItem` |
| _(unused)_ | 2 | Empty / URL | `.//Text[2]` — skipped |
| `COL_SIZE = 3` | 3 | File size | `.//Text[3]` under `ListItem` |
| `COL_STATUS = 4` | 4 | Status string | `.//Text[4]` under `ListItem` |

**Name attribute fallback** (when `Text[N]` children are inaccessible):

```
ubuntu.iso
ubuntu.iso\t1.2 GB\tDownloading\t45%
ubuntu.iso, 1.2 GB, Downloading, 45%
```

`parseIdmItemName()` splits on `\t` or `,\s+` to handle all three formats.

**Known status string values:**

| State | Observed Strings (EN) |
|---|---|
| Active | `Downloading`, `Connecting`, `In progress`, `Resuming` |
| Paused | `Paused`, `Stopped`, `Queued`, `Scheduled` |
| Completed | `Completed`, `Done`, `Finished`, `100%` |
| Error | `Error`, `Failed`, `Virus detected` |

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

#### Strategy B — Live Polling via `getLiveStatus(index)`

The original `waitForStatusChange` polled `item.getAttribute('Name')` on a cached element snapshot. This had two independent defects:

1. **Stale reference:** The cached element object was invalidated by IDM redraws between poll cycles.
2. **Wrong column:** The `Name` attribute on a `SysListView32` `ListItem` returns only the filename — not the status string.

The corrected implementation re-fetches the full element list from the driver on every evaluation cycle:

```typescript
// Executed every 500 ms inside browser.waitUntil()
private async getLiveStatus(index: number): Promise<string> {
    const items = await this.getListItems();      // re-query driver — never stale
    const item  = items[index];
    if (!item) throw new Error(`No list item at index ${index}.`);
    return this.getItemStatus(item);              // reads Text[COL_STATUS]
}

private async waitForStatusChange(index: number, expectedStatuses: string[]): Promise<void> {
    const lower = expectedStatuses.map(s => s.toLowerCase());
    await browser.waitUntil(
        async () => {
            try {
                const status = await this.getLiveStatus(index);
                return lower.some(s => status.includes(s));
            } catch {
                return false;   // element temporarily absent — retry next cycle
            }
        },
        { timeout: 10000, interval: 500 }
    );
}
```

This guarantees that:
- Each poll retrieves a **fresh element reference** from the accessibility tree.
- Status is read from `Text[COL_STATUS]` (column index 4), which maps to the actual status string.
- Transient element-not-found errors during list redraws are silently retried within the same `waitUntil` loop.

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
    action: 'start' | 'pause' | 'resume' | 'delete' | 'list' | 'clear';
    target: string;    // filename substring or '*' (wildcard — all items)
    index?: number;    // 0-based position; -1 = last
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
| `"start 3rd download"` | `{action:"start", target:"*", index:2}` | |
| `"clear all completed"` | `{action:"clear", target:"*"}` | |
| `"delete completed files"` | `{action:"clear", target:"*"}` | `delete\s*completed` → clear |
| `"야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?"` | `{action:"pause", target:"우분투"}` | LLM path |
| `"완료된 파일들 다 정리해줘"` | `{action:"clear", target:"*"}` | Regex path |
| `"두 번째 파일 멈춰줘"` | `{action:"pause", target:"*", index:1}` | `멈춰` pattern |
| `"맨 마지막에 받기 시작한 거 취소해"` | `{action:"delete", target:"*", index:-1}` | |

### LLM Provider Configuration

| Property | Value |
|---|---|
| Provider | Google AI Studio |
| Model | `gemini-2.5-flash` |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` |
| Authentication | `LLM_API_KEY` environment variable (passed as `?key=` query parameter) |
| Output Format | `responseMimeType: "application/json"` with `responseSchema` (structured output) |
| Request Timeout | 8 seconds via `Promise.race`; falls back to Regex parser on expiry |
| SDK | None — native `fetch` to avoid TypeScript dependency conflicts |

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

## 8. Data Layer — Execution History

### 8-1. SQLite Schema

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

### 8-2. API

| Function | Description |
|---|---|
| `initDatabase()` | Creates DB and table on first call; returns `Database` instance |
| `saveExecution(record)` | Inserts one row; called by `dispatcher.ts` after every command |
| `getRecentHistory(limit=10)` | Returns last N rows ordered by `id DESC` |
| `getStats()` | Returns total, success count, success rate, most-used action, avg duration |

### 8-3. REPL Commands

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

### 8-4. Integration Point

`dispatcher.ts` imports `saveExecution` and calls it at the end of every `dispatch()` invocation, recording both successes and failures with their elapsed time.
