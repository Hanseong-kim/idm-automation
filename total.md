Create a new file COMBINED_ASSIGNMENT.md in the project root.
This file merges two assignment documents into one unified goal.

Write the following content exactly:

---

# IDM AI-Powered Desktop Automation Assistant

## Unified Objective

Build an AI-powered automation assistant that:
1. Connects to Internet Download Manager (IDM) via Appium/WinAppDriver
2. Automatically discovers IDM's UI structure and workflows
3. Accepts natural language commands (Korean + English)
4. Plans and executes tasks autonomously inside IDM
5. Provides real-time feedback and audit logs

---

## Core Requirements (from both assignments)

### 1. Application Discovery
- Detect IDM window and analyze its structure automatically
- Identify all UI elements: toolbar buttons, ListView, dialogs, menus
- Capture screenshots during execution
- Build internal representation of IDM's UI (live scan, not hardcoded)

### 2. Workflow Discovery & Generation
- Auto-generate workflows from discovered UI elements
- Output: screen hierarchy, navigation map, workflow diagrams, action sequences
- Example:
Delete Download
├── Select item in ListView
├── Click Delete toolbar button
├── Handle confirmation dialog
└── Verify item removed

### 3. Natural Language Processing
- Support Korean and English commands
- Examples:
  - "pause first download"
  - "첫 번째 다운로드 멈춰줘"
  - "delete the ubuntu file"
  - "완료된 것들 다 지워줘"
- Identify intent, extract parameters
- Ask follow-up if information is missing

### 4. Task Planning
- Before execution, generate step-by-step plan
- Show plan to user before running
- Example:
Task Plan: "delete ubuntu.iso"
├── 1. Locate ubuntu.iso in download list
├── 2. Select the item
├── 3. Click Delete toolbar button (index 4)
├── 4. Handle confirmation dialog (예/아니오)
└── 5. Verify item removed from list

### 5. Task Execution
- Click UI elements (NOT coordinates - use XPath/Name selectors)
- Handle popups and dialogs
- Recover from errors automatically
- Retry failed operations (withRetry wrapper)
- Supported actions: start, pause, resume, delete, list, clear

### 6. Monitoring & Feedback
- Real-time step-by-step output:
[✓] Step 1/3: Download list extracted
[✓] Step 2/3: Target resolved - "ubuntu.iso"
[✓] Step 3/3: ubuntu.iso deleted successfully
[✓] Completed in 2341ms
- Audit log file saved to logs/
- Screenshots before/after each action saved to screenshots/

---

## Technical Stack (MANDATORY)

| Layer | Technology |
|-------|-----------|
| Automation | Appium 2.x + WinAppDriver + WebdriverIO v9 |
| Language | TypeScript + Node.js (tsx) |
| AI/NLP | Google Gemini 2.5 Flash + Regex fallback |
| Target App | Internet Download Manager (IDM) |
| UI Driver | Windows Accessibility API (UIA) |

---

## Evaluation Criteria

| Criteria | Weight |
|----------|--------|
| Workflow Discovery (auto-scan UI) | 25% |
| Natural Language Understanding | 20% |
| Automation Accuracy | 25% |
| System Design | 15% |
| Security & Reliability | 10% |
| Documentation & Presentation | 5% |

---

## Bonus Features

- [ ] Multi-agent AI architecture
- [ ] Computer vision UI understanding (screenshot analysis)
- [x] Self-healing selectors (implemented)
- [ ] MCP integration
- [ ] Voice control
- [ ] Workflow learning from demonstrations
- [x] CLI chat interface (implemented)
- [x] Memory / repeat / undo (implemented)
- [x] Batch execution (implemented)

---

## Deliverables

1. [x] Automation project (Node.js + TS + Appium/WinAppDriver)
2. [x] System architecture diagram (ARCHITECTURE.md)
3. [x] NLP module (src/agent/nlParser.ts)
4. [x] Task planning engine (src/planning/taskPlanner.ts)
5. [x] Automation execution engine (src/agent/dispatcher.ts)
6. [x] Workflow discovery module (src/discovery/workflowDiscovery.ts)
7. [x] Technical documentation (REPORT.md)
8. [ ] Final presentation / demo script
9. [x] UI analysis report (REPORT.md)

---

## Current Implementation Status

### Done
- NLP: Gemini + regex fallback, Korean/English
- Task Planning: step-by-step plan shown before execution
- Execution: start/pause/resume/delete/list/clear
- Monitoring: [✓]/[✗] logs with timestamps and audit file
- Discovery: static workflow map (needs live scan)
- CLI: interactive REPL with batch/memory/undo
- Screenshots: before/after every action

### In Progress
- delete stability (confirmation dialog handling)
- Live UI scanning (replacing hardcoded data)

### Not Started
- Security (credential storage, auth)
- Voice control
- Computer vision analysis
- Final demo script

---

## Test Commands
Start
appium --port 4724        # Terminal 1
npm run start:agent       # Terminal 2
Basic tests (need 2+ downloads in IDM queue)
Agent > list all downloads
Agent > pause first download
Agent > resume first download
Agent > delete second one
Agent > clear completed downloads
Agent > discover
Advanced tests
Agent > pause first download and list all downloads
Agent > 첫 번째 다운로드 멈춰줘
Agent > repeat
Agent > undo

---

After creating this file, also update the project README.md to 
reference COMBINED_ASSIGNMENT.md as the main goal document.