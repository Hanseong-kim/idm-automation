# IDM Automation Agent

An AI-powered desktop automation system for **Internet Download Manager (IDM) v6.x** on Windows. A natural-language REPL parses English commands, generates a step-by-step execution plan, and drives IDM through WinAppDriver via a three-tier bridge:

```
WebdriverIO v9 (W3C)  →  Appium 2.x :4724 (JSONWP proxy)  →  WinAppDriver v1.2.1 (Win32 UIA)
```

---

## Tech Stack

| Component | Technology | Version |
|---|---|---|
| Language | TypeScript (strict) | ^5.8.3 |
| Runtime | Node.js via `tsx` | ^4.19.4 |
| Test runner | WebdriverIO + Mocha | ^9.27.1 |
| Desktop bridge | Appium + appium-windows-driver | 2.x / 3.4.x |
| UI driver | WinAppDriver | 1.2.1 |
| LLM | Google Gemini 2.5 Flash | API v1beta |
| Database | better-sqlite3 | ^12.10.0 |
| Target app | Internet Download Manager | 6.x |

---

## Architecture

```
src/
├── main.ts                    REPL — PIN guard, session, command loop
├── agent/
│   ├── nlParser.ts            NLP: Gemini 2.5 Flash → regex fallback
│   ├── dispatcher.ts          Command router; records every result to SQLite
│   ├── targetResolver.ts      Fuzzy match: index / status keyword / filename
│   └── types.ts               IdmCommand, DownloadItem, CommandResult
├── planning/
│   └── taskPlanner.ts         Generates step-by-step plan shown before execution
├── monitoring/
│   └── executionMonitor.ts    [✓]/[✗] console output + timestamped audit log
├── discovery/
│   ├── appScanner.ts          Live element query ($$) for toolbar order + XML scan for other elements
│   └── workflowDiscovery.ts   Static IDM UI map and workflow diagrams
├── database/
│   └── executionHistory.ts    SQLite schema, saveExecution(), getStats()
├── security/
│   └── credentialManager.ts   AES-256-CBC key storage + machine-bound decryption
├── voice/
│   └── voiceInput.ts          fs.watch on voice-input.txt
└── plugins/
    ├── AppPlugin.ts            Interface (name, processName, capabilities, actions)
    ├── IdmPlugin.ts            IDM implementation wrapping IdmPage
    └── PluginRegistry.ts       Map<name → AppPlugin>

test/pageobjects/IdmPage.ts    Win32 UIA page object (all IDM interactions)
```

### NLP pipeline

```
User input
    │
    ▼  Gemini 2.5 Flash (8 s timeout, responseSchema JSON)
    │  fail / timeout / no key
    ▼  Regex fallback parser (always available)
    │
    ▼  IdmCommand { action, target, index? }
    │
    ▼  taskPlanner → prints plan
    │
    ▼  dispatcher → resolveTarget → IdmPage → WinAppDriver
    │
    ▼  ExecutionMonitor ([✓]/[✗]) + SQLite record
```

---

## Installation

### Prerequisites

| Requirement | Notes |
|---|---|
| Windows 10/11 64-bit | |
| Node.js ≥ 18 | `node -v` to verify |
| Internet Download Manager 6.x | Default install path |
| WinAppDriver 1.2.1 | Listens on port 4723. Must run at the same privilege level as IDM — if IDM runs as a normal user, WinAppDriver does too (both elevated or both non-elevated). |
| Appium 2.x or 3.x | Globally installed; listens on port 4724 |

```powershell
# Install Appium globally (one-time)
npm install -g appium

# Install the Windows driver (one-time)
appium driver install windows

# Install project dependencies
npm install
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `LLM_API_KEY` | Optional | Google AI Studio key for Gemini NLP |
| `AGENT_PIN` | Optional | SHA-256 hex of session PIN (see below) |
| `DEBUG_MODE` | Optional | Set to `true` to enable verbose UI diagnostics |

Create `.env` in the project root:

```env
LLM_API_KEY=your_google_ai_studio_key_here
```

If `LLM_API_KEY` is absent, the agent falls back to the regex parser automatically. All core functionality works without a key.

---

## How to Run

### Interactive REPL

```powershell
npm run start:agent
```

Connects to IDM via Appium (must be running on port 4724) and opens an interactive command prompt.

### WebdriverIO test suite

```powershell
npm run wdio
```

`@wdio/appium-service` starts and stops Appium automatically. WinAppDriver must already be running as Administrator. IDM must be open; if the download queue is empty, interaction tests are marked **SKIPPED** rather than PASSED.

---

## Available Commands

### Download actions

| Command | Description |
|---|---|
| `list all downloads` | Show all downloads with per-item state label (see below) |
| `add <url>` / `download using url: <url>` | Add a new download from a URL |
| `pause <file or ordinal>` | Pause an active download |
| `resume <file or ordinal>` | Resume a paused download |
| `start <file or ordinal>` | Force-start a queued download |
| `delete <file or ordinal>` | Remove a download from the list |
| `clear all completed` | Bulk-delete all 100%-complete entries |

**Ordinal forms:** `first`, `second`, `third`, `last`, `latest`, `newest`, `most recent`, `3rd`, `#2`, `number 2`

**Filename match:** `pause ubuntu.iso` — case-insensitive substring

**`list` output format** — each row shows a state label derived from the transfer speed column (`Text[6]`). Because IDM 6.42 shows a progress percentage in both active and paused states, the label uses transfer speed to distinguish them accurately:
```
[1] linuxmint-22.iso   | 2.85 GB | 100%    | [완료]
[2] ubuntu-amd64.iso   | 6.07 GB | 18.13%  | [받는중 11.45 MB/sec]
[3] ubuntu-arm64.iso   | 3.87 GB | 0.39%   | [멈춤]
[4] broken-file.zip    | —       | Error   | [Not Found]
```

**Follow-up (ambiguous target):** When a target-requiring command (`pause`, `resume`, `start`, `delete`) is entered without a specific file or ordinal, the agent fetches the download list, filters to action-viable candidates, and presents a numbered menu:
```
Agent > resume
[Agent] Which download do you want to resume?
  1) ubuntu-22.04-amd64.iso  [21.75%]
  2) ubuntu-22.04-arm64.iso  [58.66%]
Enter number (1-2, or anything else to cancel): 1
[Agent] Selected: ubuntu-22.04-amd64.iso
```
If only one viable candidate exists it is selected automatically; if none exist the agent reports so and exits without action. Follow-up is disabled in batch mode (`and`/`then`).

**Batch:** separate commands with `and` or `then`:
```
pause first download and delete the last
resume ubuntu.iso then list all downloads
```

### Memory

| Command | Description |
|---|---|
| `repeat` / `do it again` | Re-run the last successful command |
| `undo` | Invert last reversible action (pause↔resume, start→pause) |

`delete`, `clear`, and `list` are irreversible and cannot be undone.

### Discovery

| Command | Description |
|---|---|
| `discover` / `workflows` | Live UI scan + static workflow map |
| `screenshot` | Save `screenshots/manual-<timestamp>.png` |

`discover` calls `browser.getPageSource()` to enumerate live UI elements (buttons, lists, toolbars), prints counts and auto-generated workflows, then shows the full static IDM screen hierarchy.

### AI model selection

Switch the NLP backend at runtime without restarting:

| Command | Description |
|---|---|
| `model` | Show current provider and available options |
| `model gemini` | Google Gemini 2.5 Flash — structured JSON, 8 s timeout (default) |
| `model ollama` | Local llama3 via Ollama — requires `ollama serve` on localhost:11434 |
| `model regex` | Regex-only — no LLM call, instant, no API quota |

```
Agent > model
[Model] Current: gemini
[Model] Available: gemini | ollama | regex

Agent > model regex
[Model] Switched to: regex (LLM skipped — fast, no quota)
```

The setting persists for the session. `LLM_API_KEY` absent at startup automatically selects `regex` as the effective provider.

### History & stats

| Command | Description |
|---|---|
| `history` | Last 10 executed commands with [✓]/[✗] and timing |
| `stats` | Total commands, success rate, most-used action, avg duration |

### Plugins

```
Agent > plugins
Registered plugins: idm
```

### Exit

```
Agent > exit
```

---

## Voice Input

Write any REPL command to `voice-input.txt` in the project root; the agent reads it, executes it, and clears the file.

```
Agent > voice start
[Voice] Watching voice-input.txt for commands...
```

From another terminal (or a speech-to-text tool):

```powershell
"pause first download" | Out-File voice-input.txt -Encoding utf8
```

The watcher fires immediately, the command executes, and the file is cleared. Stop with:

```
Agent > voice stop
```

---

## Session PIN

Protect the agent with a PIN by setting `AGENT_PIN` to the **SHA-256 hex digest** of the PIN:

```powershell
# Generate hash for PIN "1234"
node -e "console.log(require('crypto').createHash('sha256').update('1234').digest('hex'))"
# 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4

$env:AGENT_PIN = "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4"
npm run start:agent
```

At startup the agent prompts `Enter PIN:`. After 3 failed attempts it exits with code 1. If `AGENT_PIN` is not set the check is skipped entirely.

The LLM API key is stored encrypted at `%APPDATA%\idm-agent\credentials.enc` (AES-256-CBC, machine-bound key derived from hostname + username). On first run without a `.env` file, the agent prompts for the key interactively (TTY only) and stores it for subsequent runs.

---

## Execution History

Every command is automatically recorded to `data/history.db` (SQLite, created on first run).

```
Agent > history

[History] Last 3 command(s):

  [✓] [09:22:14] pause ubuntu.iso  (2134ms)
        action: pause → "ubuntu.iso"
  [✗] [09:21:58] pause nonexistent.zip  (621ms)  FAILED: No downloads found
        action: pause → "nonexistent.zip"
  [✓] [09:21:30] list all downloads  (1048ms)
        action: list

Agent > stats

[Stats] Execution Statistics

  Total commands   : 12
  Successful       : 10 (83%)
  Most used action : pause
  Avg duration     : 1847ms
```

---

## Debug Mode

Set `DEBUG_MODE=true` to enable verbose diagnostics:

- Prints window title and handle on every `extractDownloads()` call
- Logs which selector strategy found list items (5 fallback strategies)
- Logs raw `Name` attribute for each download row before parsing
- Saves the live UIA XML tree to `logs/pagesource-debug.xml`

```powershell
$env:DEBUG_MODE = "true"
npm run start:agent
```

Audit logs are always written to `logs/audit-<session>.log` regardless of debug mode. Screenshots are saved to `screenshots/` automatically before and after every download command.

---

## Implemented Features

### Core automation
- **IDM page object** (`test/pageobjects/IdmPage.ts`) — pause, resume, start, delete, clear; WinAppDriver XPath selectors with 5-strategy fallback; `withRetry()` exponential backoff; self-healing context menu matching (normalised label scan)
- **Task planning** — step-by-step plan printed before every execution
- **Execution monitoring** — `[✓]`/`[✗]` step output with timestamps; audit log file per session
- **Pre-condition guards** — skip no-op actions (already paused, already active); validate completed state before action
- **`ensureSelected()`** — re-clicks item if UIA `IsSelected` is not `True` before toolbar button press

### NLP
- **Three-provider parser** — runtime-selectable via `model` command: `gemini` (Gemini 2.5 Flash, structured JSON schema, 8 s timeout), `ollama` (local llama3, 15 s timeout), `regex` (instant, no API call); LLM failure or timeout falls back to regex automatically
- **LLM index guard** — `EXPLICIT_POSITION_RE` strips any `index` the LLM inferred without an explicit position keyword in the input (e.g. bare `"resume"` → index removed → follow-up question shown instead)
- **Language support** — regex fallback handles **English** (ordinals: first/second/last/latest/newest/3rd/#2, filename substrings, status keywords); LLM paths handle **English and Korean** (e.g., `"우분투 파일 멈춰줘"` → pause)
- **Actions** — `add` (URL → new download), `start`, `pause`, `resume`, `delete`, `list`, `clear`
- **Follow-up questions** — ambiguous target commands prompt a numbered candidate list filtered by action viability (active candidates for pause, non-transferring for resume/start, all for delete)
- **Batch commands** — split on `and`/`then`, sequential execution; follow-up disabled in batch

### Agent features
- **Memory** — `repeat` and `undo` with logical inversion map
- **Workflow discovery** — live XML scan (`discover`) + static IDM UI map
- **Voice input** — `fs.watch` on `voice-input.txt`
- **Execution history** — SQLite; `history` and `stats` REPL commands
- **Plugin architecture** — `AppPlugin` interface; `IdmPlugin`; `PluginRegistry`
- **Session PIN** — SHA-256 hash comparison; 3-attempt lockout
- **Credential manager** — AES-256-CBC encrypted storage at `%APPDATA%\idm-agent\`
- **Screenshots** — before/after every action, saved to `screenshots/`
- **Debug mode** — `DEBUG_MODE=true` env flag

---

## Performance

Per-command timing is measured in four stages and printed as `[Perf]` lines after each execution:

```
[Perf] parse: 312ms | plan: 1ms | dispatch: 4821ms | screenshots: 203ms
[Perf] command processing (parse+plan): 313ms (pdf target <3000ms: PASS)
```

For `discover` / `workflows`:
```
[Perf] scan: 3241ms | workflow-gen: 12ms
[Perf] workflow generation total: 3253ms (pdf target <10000ms: PASS)
```

| Metric | Observed | PDF Target | Result |
|---|---|---|---|
| Command processing (parse + plan) — Gemini | ≤ ~1 800 ms | < 3 000 ms | **PASS** |
| Command processing (parse + plan) — regex | < 5 ms | < 3 000 ms | **PASS** |
| Workflow generation (`discover`) | ~2 700 ms | < 10 000 ms | **PASS** |
| Total command execution (wall clock) | 10 – 18 s | — | see note |
| UI recognition accuracy (valid commands, regex mode) | 100% (10/10) | > 90% | **PASS** |

> **Note:** Total wall-clock time (10–18 s) is dominated by IDM UI response latency and `waitForTransferState` polling (transfer-speed confirmation after pause/resume/start). These are inherent to the target application and are not part of the automation's processing time. The automation processing itself (`parse + plan`) consistently meets the 3 s target.

**UI recognition accuracy** was measured by running 10 valid commands (list, add, pause, resume, delete, clear — all 6 action types, with a matching target present) against a clean `history.db`, then reading `stats`. Result: **10/10 = 100%** (pdf target > 90%: **PASS**). Measured in `regex` mode to exclude Gemini free-tier quota limits from the result. Commands that correctly reject a missing or already-completed target are treated as robustness, not recognition failure.

---

## Evaluation Criteria Coverage

| Category | Weight | Implementation |
|---|---|---|
| Workflow Discovery | 25% | `appScanner.ts` parses live UIA XML; `workflowDiscovery.ts` generates full screen hierarchy and 6 workflow definitions |
| Natural Language Understanding | 20% | Gemini 2.5 Flash with JSON schema; regex fallback covers add/start/pause/resume/delete/list/clear with ordinal, latest/newest, and filename extraction |
| Automation Accuracy | 25% | Pre-condition checks, `ensureSelected()`, `withRetry(3)`, `waitForTransferState()` transfer-speed polling (Text[6]), 5-strategy selector fallback |
| System Design | 15% | Layered architecture: NLP → Planning → Dispatch → UI; plugin interface; SQLite data layer; monitoring module |
| Security & Reliability | 10% | AES-256-CBC credential storage; SHA-256 session PIN; non-fatal error handling on all I/O side effects |
| Documentation & Presentation | 5% | `REPORT.md` (573 lines), `ARCHITECTURE.md` (311 lines), `COMBINED_ASSIGNMENT.md`, this README |
