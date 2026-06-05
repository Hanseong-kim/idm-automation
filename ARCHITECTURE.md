# System Architecture — IDM AI Automation Agent

## Overview

An AI-powered desktop automation agent for Internet Download Manager (IDM).
Natural language commands (English + Korean) are parsed, planned, executed,
and monitored against the live IDM desktop application via WinAppDriver.

---

## System Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║                    IDM AI AUTOMATION AGENT                           ║
╚══════════════════════════════════════════════════════════════════════╝

┌──────────────────────────────────────────────────────────────────────┐
│  USER INTERFACE LAYER                          src/main.ts           │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  CLI REPL (readline)                                           │  │
│  │  • Interactive "Agent > " prompt                               │  │
│  │  • Batch splitting: "pause X and delete Y" → 2 sub-commands   │  │
│  │  • Memory: repeat / undo (with UNDO_MAP inversion table)       │  │
│  │  • Follow-up: candidatesFor() → numbered menu when ambiguous   │  │
│  │  • model [gemini|ollama|regex] — runtime AI provider switch    │  │
│  │  • timed() — per-stage [Perf] instrumentation                  │  │
│  │  • Built-in commands: discover, screenshot, history, exit      │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ raw text
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  NLP LAYER                             src/agent/nlParser.ts         │
│                                                                      │
│  Runtime provider (setProvider / model REPL command):                │
│                                                                      │
│  ┌──────────────────────┐ ┌──────────────────────┐ ┌─────────────┐  │
│  │  Gemini 2.5 Flash    │ │  Ollama (llama3)      │ │  Regex      │  │
│  │  • JSON schema       │ │  • localhost:11434    │ │  • EN only  │  │
│  │  • 8 s timeout       │ │  • 15 s timeout       │ │  • instant  │  │
│  │  • EN + Korean       │ │  • EN + Korean        │ │  • no quota │  │
│  └──────────────────────┘ └──────────────────────┘ └─────────────┘  │
│    LLM fail / timeout ──────────────────────────────► regex fallback │
│    EXPLICIT_POSITION_RE guard: strip LLM-inferred index when no      │
│    explicit position keyword (prevents follow-up bypass)             │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ IdmCommand { action, target, index }
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  TASK PLANNING ENGINE              src/planning/taskPlanner.ts  [NEW]│
│                                                                      │
│  • Generates step-by-step execution plan from IdmCommand             │
│  • Displays plan tree before execution starts                        │
│  • Estimates execution time per action type                          │
│                                                                      │
│  Example output:                                                     │
│    Task Plan: "delete ubuntu.iso"                                    │
│    ├── 1. Locate download "ubuntu.iso" in list                       │
│    ├── 2. Select the download item                                   │
│    ├── 3. Click Delete toolbar button (btn 4)                        │
│    ├── 4. Handle confirmation dialog                                 │
│    └── 5. Verify item removed from list                              │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ ExecutionPlan { steps[] }
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EXECUTION ENGINE                  src/agent/dispatcher.ts           │
│                                                                      │
│  • Routes IdmCommand to UiFunctions interface                        │
│  • Delegates target matching to targetResolver.ts                    │
│  • Emits step-level monitoring events → ExecutionMonitor             │
│  • Structured output: [✓] / [✗] per action item                     │
│                                                                      │
│  Target Resolution (targetResolver.ts):                              │
│    index  → positional (supports negative: -1 = last)               │
│    name   → substring match (case-insensitive)                       │
│    status → keyword map (completed/paused/downloading/failed)        │
│    *      → all downloads                                            │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ UI method calls
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  UI AUTOMATION LAYER          test/pageobjects/IdmPage.ts            │
│                                                                      │
│  • WinAppDriver selectors (SysListView32, Toolbar Button/SplitButton)│
│  • Self-healing: context menu label normalization (strip ~, ellipsis)│
│  • withRetry() wrapper — resilience against transient WDA failures   │
│  • waitForTransferState() — polls Text[6] transfer speed (COL_SPEED) │
│    for pause/resume/start verification; isTransferring() > 0 = active│
│  • dumpUITree() — full XML tree dump for debugging                   │
│  • browser.saveScreenshot() — captures PNG before/after actions      │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ W3C WebDriver Protocol (HTTP)
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  APPIUM PROXY  (127.0.0.1:4724)                                      │
│  appium-windows-driver v5.4.0                                        │
│  Translates W3C WebDriver → JSONWP for WinAppDriver                  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ JSONWP / WinAppDriver Protocol
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  TARGET APPLICATION                                                  │
│  Internet Download Manager — IDMan.exe                               │
│  Win32 Desktop App · SysListView32 download queue                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Supporting Modules

```
┌─────────────────────────────┐   ┌────────────────────────────────┐
│  Workflow Discovery          │   │  Execution Monitor             │
│  src/discovery/              │   │  src/monitoring/               │
│  workflowDiscovery.ts  [NEW] │   │  executionMonitor.ts     [NEW] │
│                              │   │                                │
│  • Static IDM UI screen map  │   │  • [✓]/[✗] per-step logging   │
│  • 6 workflow definitions    │   │  • Timestamped console output  │
│  • Navigation map diagram    │   │  • Writes audit log to file    │
│  • Printable tree output     │   │    logs/audit-<session>.log    │
│                              │   │  • Command timing (ms)         │
│  Command: "discover"         │   │  • Non-fatal log write errors  │
└─────────────────────────────┘   └────────────────────────────────┘
```

---

## Data Flow

```
User Input
    │
    ▼
"pause ubuntu.iso"
    │
    ▼  nlParser.ts
IdmCommand { action: 'pause', target: 'ubuntu.iso' }
    │
    ▼  taskPlanner.ts
ExecutionPlan {
  steps: [
    "Locate download 'ubuntu.iso' in IDM list",
    "Select the download item",
    "Click Pause toolbar button (btn 2)",
    "Wait for transfer speed (Text[6]) to reach 0 (paused)",
    "Verify pause succeeded"
  ]
}  →  printed to console
    │
    ▼  dispatcher.ts + executionMonitor.ts
[✓] Step 1/3: Extracting download list from IDM
[✓] Step 2/3: Resolving target: "ubuntu.iso"
[✓] Target resolved — 1 item(s): "ubuntu.iso"
[✓] Step 3/3: "ubuntu.iso" paused successfully.
[✓] "pause ubuntu.iso" completed successfully in 2134ms
    │
    ▼
CommandResult { success: true, message: '"ubuntu.iso" paused successfully.' }
```

---

## Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| CLI REPL | `src/main.ts` | User I/O, batch splitting, memory/undo, follow-up questions, model selection, performance timing (`timed`), session mgmt |
| NLP Parser | `src/agent/nlParser.ts` | Text → IdmCommand; runtime provider (gemini/ollama/regex); EXPLICIT_POSITION_RE index guard; regex fallback |
| Task Planner | `src/planning/taskPlanner.ts` | IdmCommand → step-by-step plan display |
| Dispatcher | `src/agent/dispatcher.ts` | Command routing + monitoring integration |
| Target Resolver | `src/agent/targetResolver.ts` | Fuzzy-match target name/index/status |
| UI Page Object | `test/pageobjects/IdmPage.ts` | WinAppDriver selector + retry logic |
| Workflow Discovery | `src/discovery/workflowDiscovery.ts` | Static IDM UI map + workflow diagrams |
| Live App Scanner | `src/discovery/appScanner.ts` | getPageSource() XML parse + live workflow gen |
| Execution Monitor | `src/monitoring/executionMonitor.ts` | Step logging + audit trail |
| Credential Manager | `src/security/credentialManager.ts` | AES-256 key storage, PIN guard |
| Execution History | `src/database/executionHistory.ts` | SQLite history + stats |
| App Plugin Interface | `src/plugins/AppPlugin.ts` | Multi-app extensibility contract |
| IDM Plugin | `src/plugins/IdmPlugin.ts` | IDM implementation of AppPlugin |
| Plugin Registry | `src/plugins/PluginRegistry.ts` | Register / lookup plugins by name |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.8 (strict, ESNext, allowSyntheticDefaultImports) |
| Test Runner | WebdriverIO v9 + Mocha |
| Desktop Bridge | Appium 2.x + appium-windows-driver v5.4.0 |
| UI Driver | WinAppDriver (Windows Accessibility API) |
| LLM / NLP | Google Gemini 2.5 Flash (REST API) · Ollama llama3 (local) · built-in regex |
| Runtime | Node.js via `tsx` (no build step) |
| Database | SQLite via `better-sqlite3` (native, synchronous) |
| Target App | Internet Download Manager (Win32) |

---

## Plugin Architecture

The system is designed to automate any desktop application, not just IDM. The plugin interface decouples app-specific code from the agent core.

```
┌──────────────────────────────────────────────────┐
│  Agent Core (main.ts, dispatcher.ts, nlParser.ts) │
└──────────────────────┬───────────────────────────┘
                       │ uses
                       ▼
┌──────────────────────────────────────────────────┐
│  AppPlugin Interface  (src/plugins/AppPlugin.ts)  │
│  + name, processName, capabilities               │
│  + actions.list()  actions.execute(cmd, target)  │
└──────────────────────┬───────────────────────────┘
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐      ┌────────────────────────┐
│  IdmPlugin       │      │  FuturePlugin          │
│  (IDMan.exe)     │      │  (Notepad, Chrome, …)  │
│  wraps IdmPage   │      │  new implementation    │
└──────────────────┘      └────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────┐
│  PluginRegistry  (src/plugins/PluginRegistry.ts) │
│  Map<name → AppPlugin>                           │
│  registerPlugin() / getPlugin() / listPlugins()  │
└──────────────────────────────────────────────────┘
```

Adding a new target app requires only:
1. Create `src/plugins/MyAppPlugin.ts` implementing `AppPlugin`
2. Call `registerPlugin(new MyAppPlugin())` in `main.ts`

---

## Data Layer

```
┌─────────────────────────────────────────────────────────┐
│  Execution History  (src/database/executionHistory.ts)  │
│                                                         │
│  data/history.db  (SQLite, created on first run)        │
│                                                         │
│  Table: executions                                      │
│    id           INTEGER  PK AUTOINCREMENT               │
│    timestamp    TEXT     ISO-8601                       │
│    command_text TEXT     raw user input                 │
│    action       TEXT     pause/resume/delete/…          │
│    target       TEXT     filename or *                  │
│    success      INTEGER  0 or 1                         │
│    duration_ms  INTEGER  wall-clock ms                  │
│    error_message TEXT    nullable                       │
│                                                         │
│  API:                                                   │
│    saveExecution(record)  — called by dispatcher.ts     │
│    getRecentHistory(n)    — "history" REPL command      │
│    getStats()             — "stats" REPL command        │
└─────────────────────────────────────────────────────────┘
```

---

## Security Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Session PIN Guard  (main.ts: checkSessionPin())         │
│  AGENT_PIN env var = SHA-256 hash of the PIN             │
│  Max 3 attempts → process.exit(1) on failure             │
│  Skipped when AGENT_PIN is not set (dev/CI mode)         │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  Credential Manager  (src/security/credentialManager.ts) │
│                                                          │
│  Priority: env var → encrypted file → TTY prompt         │
│                                                          │
│  Storage: %APPDATA%\idm-agent\credentials.enc            │
│  Cipher:  AES-256-CBC                                    │
│  Key:     SHA-256(hostname + ":" + username + ":v1")     │
│  IV:      16 random bytes per write (stored with data)   │
│  Format:  <iv-hex>:<ciphertext-hex>                      │
│                                                          │
│  Raw key values are NEVER logged or printed.             │
└──────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions

**Dual-path NLP** — LLM first with 8s timeout, regex fallback on failure.
Ensures the agent works offline or when the API key is absent.

**UiFunctions interface** — Dispatcher is decoupled from IdmPage via an
interface, enabling easy unit testing with mock implementations.

**AppPlugin interface** — Any desktop app can be targeted by implementing
three fields (`name`, `processName`, `capabilities`) and two async methods
(`list`, `execute`). The registry maps names to implementations at runtime.

**withRetry() in IdmPage** — WinAppDriver occasionally returns transient
failures. A retry wrapper at the UI layer isolates this from business logic.

**Self-healing selectors** — Context menu items are matched by normalised
text (stripped tildes, ellipses, lowercased) rather than exact AutomationId,
handling IDM's localised/versioned menu labels.

**Optional monitor + rawText in dispatch()** — `dispatch(cmd, ui, monitor?, rawText?)` is
backward-compatible: existing tests call it with 2 args; the REPL passes all 4
to enable rich logging and DB recording simultaneously.

**Non-fatal DB/screenshot/log failures** — All persistence side-effects are
wrapped in try/catch so disk-full, missing dirs, or native-module failures
never abort automation of the primary target.

**Transfer-speed state detection** — IDM 6.42 writes progress percentages
into Text[4] for both active and paused downloads, making string-matching on
status words unreliable. The automation reads Text[6] (transfer speed,
COL_SPEED) instead: a numeric value > 0 means active; empty or zero means
paused. This drives `isTransferring()`, `waitForTransferState()`, `candidatesFor()`
follow-up filtering, and the `list` output state labels.

**Runtime model selection + LLM index guard** — `parseCommand` dispatches to
gemini, ollama, or regex based on `currentProvider` (set by `setProvider()` /
`model` REPL command). On LLM failure or timeout, regex activates
automatically. `EXPLICIT_POSITION_RE` strips any index the LLM inferred
without an explicit position keyword in the input, ensuring ambiguous commands
always reach the follow-up question flow rather than silently targeting the
last item.
