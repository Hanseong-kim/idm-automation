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
│   ├── appScanner.ts          Live XML scan: parses browser.getPageSource()
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
| WinAppDriver 1.2.1 | Run as Administrator; listens on port 4723 |
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
| `list all downloads` | Show all downloads with status |
| `pause <file or ordinal>` | Pause an active download |
| `resume <file or ordinal>` | Resume a paused download |
| `start <file or ordinal>` | Force-start a queued download |
| `delete <file or ordinal>` | Remove a download from the list |
| `clear all completed` | Bulk-delete all 100%-complete entries |

**Ordinal forms:** `first`, `second`, `third`, `last`, `3rd`, `#2`, `number 2`

**Filename match:** `pause ubuntu.iso` — case-insensitive substring

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
- **Dual-path parser** — Gemini 2.5 Flash (structured JSON, 8 s timeout) → regex fallback
- **English-only** — ordinal forms (first/second/last/3rd/#2), filename substrings, status keywords
- **Batch commands** — split on `and`/`then`, sequential execution

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

## Evaluation Criteria Coverage

| Category | Weight | Implementation |
|---|---|---|
| Workflow Discovery | 25% | `appScanner.ts` parses live UIA XML; `workflowDiscovery.ts` generates full screen hierarchy and 6 workflow definitions |
| Natural Language Understanding | 20% | Gemini 2.5 Flash with JSON schema; regex fallback covers start/pause/resume/delete/list/clear with ordinal and filename extraction |
| Automation Accuracy | 25% | Pre-condition checks, `ensureSelected()`, `withRetry(3)`, `waitForStatusChange()` polling, 5-strategy selector fallback |
| System Design | 15% | Layered architecture: NLP → Planning → Dispatch → UI; plugin interface; SQLite data layer; monitoring module |
| Security & Reliability | 10% | AES-256-CBC credential storage; SHA-256 session PIN; non-fatal error handling on all I/O side effects |
| Documentation & Presentation | 5% | `REPORT.md` (573 lines), `ARCHITECTURE.md` (311 lines), `COMBINED_ASSIGNMENT.md`, this README |
