# IDM Automation — AI Agent

An AI-powered command-line agent for automating Internet Download Manager (IDM) on Windows.
Natural-language commands are parsed by **Google Gemini 2.5 Flash** and executed via
**WebdriverIO v9 → Appium 2.x → WinAppDriver**.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Windows | 10 / 11 | 64-bit |
| Node.js | ≥ 18 | `node -v` |
| IDM | 6.x | Installed at default path |
| WinAppDriver | 1.2.1 | Run as Administrator |
| Appium | 2.x | With `appium-windows-driver` |

### Install Appium and the Windows driver

```powershell
npm install -g appium
appium driver install windows
```

---

## Setup

### 1. Clone and install dependencies

```powershell
git clone <repo-url>
cd idm-automation
npm install
```

### 2. Configure the LLM API key

Create a `.env` file in the project root:

```env
LLM_API_KEY=your_google_ai_studio_key_here
```

Get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey).

> If the key is missing or the Gemini API is unavailable the agent falls back to a
> built-in regex parser that handles the most common commands.

### 3. Start WinAppDriver (as Administrator)

```powershell
# Default install location:
& "C:\Program Files (x86)\Windows Application Driver\WinAppDriver.exe"
```

### 4. Start Appium

```powershell
appium --port 4724
```

---

## Running the AI Agent

```powershell
npm run start:agent
```

The agent connects to IDM, then waits for commands at the `Agent >` prompt.

### Example commands

```
Agent > list all downloads
Agent > pause the first download
Agent > resume ubuntu.iso
Agent > start the second download
Agent > delete the last download
Agent > clear all completed downloads
Agent > 완료된 파일 모두 지워줘
Agent > 두 번째 파일 멈춰줘
Agent > exit
```

---

## Running the WebdriverIO Test Suite

```powershell
npm run wdio
```

The `@wdio/appium-service` starts Appium automatically on port 4724.
WinAppDriver must already be running as Administrator.

---

## Project Structure

```
idm-automation/
├── src/
│   ├── main.ts                  # REPL entry point
│   └── agent/
│       ├── types.ts             # Shared TypeScript interfaces
│       ├── nlParser.ts          # Gemini NLP → structured IdmCommand
│       └── dispatcher.ts        # IdmCommand → UI action dispatcher
├── test/
│   ├── pageobjects/
│   │   └── IdmPage.ts           # WebdriverIO Page Object Model for IDM
│   └── specs/
│       └── idm.spec.ts          # Mocha test specs
├── wdio.conf.ts                 # WebdriverIO configuration
├── REPORT.md                    # UI hierarchy analysis
└── .env                         # API keys (not committed)
```

---

## Supported Actions

| Command pattern | Action | Notes |
|---|---|---|
| `list [all] downloads` | `list` | Show full queue |
| `pause <filename or ordinal>` | `pause` | Stop selected download |
| `resume <filename or ordinal>` | `resume` | Resume paused download |
| `start <filename or ordinal>` | `start` | Start queued download |
| `delete <filename or ordinal>` | `delete` | Remove from queue |
| `clear [all] completed` | `clear` | Remove all completed rows |

Ordinals: "first", "second", "last", "3rd", etc. are mapped to 0-based indices.

---

## Architecture Notes

- **No hardcoded pauses** — all UI synchronisation uses `browser.waitUntil()`.
- **Toolbar buttons** are used for start/pause/delete (indices 1/2/4) because Win32
  context menus are Desktop-parented and invisible to the Appium session.
- **LLM fallback**: if Gemini times out (> 8 s) or returns an error, a regex parser
  handles the command instead.
- See `REPORT.md` for the full UIA tree analysis and selector rationale.
