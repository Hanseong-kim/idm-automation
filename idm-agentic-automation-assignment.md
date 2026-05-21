# 🧪 Desktop Automation + Agentic AI Assignment (IDM)

## 🎯 Objective

Design and implement a **desktop automation system for Internet Download Manager (IDM)** using Windows UI automation technologies. The system must support both **traditional UI automation** and an **agentic AI layer** that converts natural language into executable automation commands.

---

# 🧰 Tools & Technologies (MANDATORY)

## Automation Stack

- Appium (Windows Driver)
- WinAppDriver
- WebDriverIO (Node.js)
- TypeScript (preferred) or JavaScript

## UI Inspection & Debugging

- Inspect.exe (Windows SDK)
- Appium Inspector

## Target Application

- Internet Download Manager (IDM)

---

# 🧩 Part 1: UI Reverse Engineering & Analysis

## 📌 Task 1: Application Structure Analysis

Inspect IDM and document the following:

- Main application window title
- Window class hierarchy
- ListView control class used for downloads
- Toolbar buttons and their identifiers
- Dialog windows (Add Download, Options, Scheduler, etc.)
- Context menu structure (right-click menu)

---

## 📌 Task 2: Control Mapping

Create a structured mapping of UI elements:

- Buttons
- ListView
- Tabs
- Dialogs
- Input fields

Include:
- Control type
- Class name
- Automation identifier (if available)
- Hierarchical location

---

## 📌 Task 3: ListView Data Extraction

Automate extraction of all downloads displayed in IDM ListView.

### Requirements:

- Count total downloads
- Iterate through all rows
- Extract:
  - File Name
  - File Size
  - Download Status
  - Download Progress (if available)

### Expected Output:

Download #1  
Name: ubuntu.iso  
Size: 2.1 GB  
Status: Completed  
Progress: 100%

---

## 📌 Task 4: UI Interaction Automation

Implement automation for:

- Start download
- Pause download
- Resume download
- Delete download
- Clear completed downloads

### Validation Requirement:

After each action:
- Verify UI state change
- Confirm ListView update

---

## 📌 Task 5: Context Menu Automation

Perform right-click operations on a selected download item:

- Open Properties
- Copy URL
- Remove download
- Open file location

---

# 🧩 Part 2: Appium + WinAppDriver Automation Layer

## 📌 Task 6: Session-Based Automation

Using Appium Windows Driver or WinAppDriver:

- Launch IDM application
- Attach to active session
- Identify main window
- Locate ListView control

---

## 📌 Task 7: Element-Based Interaction

Implement automation using UI elements (NOT coordinates):

- Click toolbar buttons
- Select ListView rows
- Scroll download list
- Open dialogs and interact with controls

---

## 📌 Task 8: Robust Element Handling

Ensure automation supports:

- Dynamic ListView updates
- Changing indices
- Delayed UI rendering
- Missing or disabled controls

---

# 🤖 Part 3: Agentic AI Automation System

## 🎯 Objective

Build a system that converts:

Natural Language → Structured Command → Automation Execution on IDM

---

## 📌 Task 9: Natural Language Parser

Convert user input into structured JSON.

Example:

Input: Pause ubuntu.iso download

Output:
{
  "action": "pause",
  "target": "ubuntu.iso"
}

---

## 📌 Task 10: Command Schema Definition

Define:

- action: start | pause | resume | delete | list | clear
- target: string
- index: optional number

---

## 📌 Task 11: Execution Engine

Build dispatcher:

- map JSON → functions
- execute on IDM UI

Supported:
- startDownload()
- pauseDownload()
- resumeDownload()
- deleteDownload()
- listDownloads()

---

## 📌 Task 12: Smart Target Resolution

Support:

- first download
- last download
- latest file
- completed downloads
- filename-based matching

---

## 📌 Task 13: Execution Feedback Loop

After action:

- validate UI state
- confirm success/failure
- return result

Example:

ubuntu.iso paused successfully

---

## 📌 Task 14: Error Handling & Recovery

Handle:
- element not found
- UI delay
- invalid command
- retry logic

---

# 🧠 Part 4: Agentic System Requirements

- Natural language understanding layer
- Command normalization layer
- Execution engine
- UI validation layer
- Logging system
- Retry mechanism

---

## ⭐ Bonus Features

- Voice command input
- Chat interface (CLI/web)
- Memory of previous commands
- Batch execution
- Self-healing selectors

---

# 📦 Deliverables

1. Automation project (Node.js + TS + Appium/WinAppDriver)
2. UI analysis report
3. Agentic AI system implementation
4. Demo with 3+ commands

---

# 🧪 Evaluation

UI automation correctness: 30%  
ListView handling: 20%  
Appium/WinAppDriver usage: 20%  
Agent design: 20%  
Code quality: 10%
