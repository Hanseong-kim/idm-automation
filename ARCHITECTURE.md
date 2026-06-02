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
│  │  • Built-in commands: discover, screenshot, exit               │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ raw text
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  NLP LAYER                             src/agent/nlParser.ts         │
│                                                                      │
│  ┌─────────────────────────────┐  ┌───────────────────────────────┐  │
│  │  Gemini 2.5 Flash (LLM)     │  │  Regex Fallback               │  │
│  │  • JSON schema output       │  │  • 11 action keywords         │  │
│  │  • 8-second timeout         │  │  • English + Korean           │  │
│  │  • Few-shot examples        │  │  • Index: 1st/2nd/last/#N     │  │
│  └─────────────────────────────┘  └───────────────────────────────┘  │
│           LLM unavailable ──────────────────────────► fallback       │
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
│  • waitForStatusChange() — polls getLiveStatus() for state sync      │
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
    "Wait for status to change to 'Paused'",
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
| CLI REPL | `src/main.ts` | User I/O, batch splitting, memory/undo, session mgmt |
| NLP Parser | `src/agent/nlParser.ts` | Text → IdmCommand (LLM + regex dual path) |
| Task Planner | `src/planning/taskPlanner.ts` | IdmCommand → step-by-step plan display |
| Dispatcher | `src/agent/dispatcher.ts` | Command routing + monitoring integration |
| Target Resolver | `src/agent/targetResolver.ts` | Fuzzy-match target name/index/status |
| UI Page Object | `test/pageobjects/IdmPage.ts` | WinAppDriver selector + retry logic |
| Workflow Discovery | `src/discovery/workflowDiscovery.ts` | IDM UI map + workflow diagrams |
| Execution Monitor | `src/monitoring/executionMonitor.ts` | Step logging + audit trail |

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript 5.8 (strict, ESNext) |
| Test Runner | WebdriverIO v9 + Mocha |
| Desktop Bridge | Appium 2.x + appium-windows-driver v5.4.0 |
| UI Driver | WinAppDriver (Windows Accessibility API) |
| LLM / NLP | Google Gemini 2.5 Flash (REST API) |
| Runtime | Node.js via `tsx` (no build step) |
| Target App | Internet Download Manager (Win32) |

---

## Key Design Decisions

**Dual-path NLP** — LLM first with 8s timeout, regex fallback on failure.
Ensures the agent works offline or when the API key is absent.

**UiFunctions interface** — Dispatcher is decoupled from IdmPage via an
interface, enabling easy unit testing with mock implementations.

**withRetry() in IdmPage** — WinAppDriver occasionally returns transient
failures. A retry wrapper at the UI layer isolates this from business logic.

**Self-healing selectors** — Context menu items are matched by normalised
text (stripped tildes, ellipses, lowercased) rather than exact AutomationId,
handling IDM's localised/versioned menu labels.

**Optional monitor parameter** — `dispatch(cmd, ui, monitor?)` keeps the
existing test suite passing while enabling rich step logging in the REPL.

**Non-fatal screenshot/log failures** — Capture errors are swallowed so
a missing `screenshots/` dir or disk-full condition never aborts automation.
