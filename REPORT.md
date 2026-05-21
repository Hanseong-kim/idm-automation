# IDM UI Analysis Report

**Project:** idm-automation  
**Target Application:** Internet Download Manager (IDM) v6.x  
**Automation Stack:** WebdriverIO v9 → Appium 2.x (appium-windows-driver) → WinAppDriver  
**Report Date:** 2026-05-19

---

## 1. Main Application Window

| Property | Value |
|---|---|
| Process | `IDMan.exe` |
| Install path | `C:\Program Files (x86)\Internet Download Manager\IDMan.exe` |
| Working directory | `C:\Program Files (x86)\Internet Download Manager` |
| UIA window title (Name) | Contains `"Internet Download Manager"` (version string appended) |
| Window class | `IEFrame` (top-level Win32 frame) |
| AutomationId | `""` (empty — Win32 native top-level window) |

**Window detection strategy:** Because the title includes a dynamic version suffix
(e.g., "Internet Download Manager 6.42 Build 3"), the automation uses
`browser.getTitle()` and checks `.toLowerCase().includes('internet download manager')`
instead of an exact-match selector. This is implemented in `IdmPage.waitForReady()`.

---

## 2. Window Class Hierarchy (UIA Tree)

```
Window [ClassName: IEFrame, AutomationId: ""]          ← session root / app frame
└── Pane [ClassName: IDMMainWindow, AutomationId: ""]  ← main client area
    ├── ToolBar [ClassName: ToolbarWindow32]            ← main toolbar
    │   ├── Button / SplitButton (추가, 시작, 중지 …)   ← toolbar buttons
    ├── Pane [ClassName: Static, AutomationId: ""]      ← category sidebar
    │   ├── ListItem [@Name="모든 다운로드"]             ← All Downloads tab
    │   ├── ListItem [@Name="미완료"]                   ← Incomplete tab
    │   ├── ListItem [@Name="완료됨"]                   ← Completed tab
    │   ├── ListItem [@Name="그래버"]                   ← Grabber tab
    │   └── ListItem [@Name="대기열"]                   ← Queue tab
    └── List [ClassName: SysListView32, AutomationId: ""]  ← download queue
        ├── ListItem                                    ← one row per download
        │   ├── Text (col 1: filename)
        │   ├── Text (col 2: size)
        │   ├── Text (col 3: status)
        │   └── Text (col 4: progress %)
        └── ...
```

> The UIA tree was mapped using **Windows Inspect.exe** (Windows SDK) and
> **Accessibility Insights for Windows**. Actual sub-pane class names may vary
> between IDM versions; only `SysListView32` and `ToolbarWindow32` are relied
> upon by the test suite.

---

## 3. Download List — `SysListView32` Control

| Attribute | Detail |
|---|---|
| UIA Control Type | `List` |
| ClassName | `SysListView32` |
| AutomationId | `""` (empty — Win32 native control) |
| XPath selector | `//List[@ClassName="SysListView32"]` |
| Child control type | `ListItem` (one per download row) |
| Child AutomationId | `""` (empty — index-addressed at runtime) |

### Column layout (1-based XPath index)

| XPath index | Content | UIA Child selector |
|---|---|---|
| 1 | File name | `.//Text[1]` under `ListItem` |
| 2 | File size | `.//Text[2]` under `ListItem` |
| 3 | Status | `.//Text[3]` under `ListItem` |
| 4 | Progress (%) | `.//Text[4]` under `ListItem` |

### Name attribute fallback format

When `Text` children are not individually accessible, WinAppDriver exposes a
composite `Name` UIA attribute on each `ListItem` in one of these formats:

```
filename
filename\t1.2 GB\tDownloading\t45%
filename, 1.2 GB, Downloading, 45%
```

`parseIdmItemName()` in `IdmPage.ts` splits on `\t` or `,\s+` to handle both.

### Known status strings

| State | Observed strings (EN / KO) |
|---|---|
| Active | `Downloading`, `Connecting`, `In progress`, `Resuming` |
| Paused | `Paused`, `Stopped`, `Queued`, `Scheduled` |
| Completed | `Completed`, `완료`, `Done`, `Finished`, `100%` |
| Error | `Error`, `Failed`, `Virus detected` |

---

## 4. Toolbar Button Mappings

IDM's toolbar uses `ToolbarWindow32`. The automation suite accesses buttons by
their 0-based visual index within `//ToolBar/*[self::Button or self::SplitButton]`
(union XPath required — the toolbar contains both `Button` and `SplitButton`
elements and the index must match the visual order).

Win32 `ToolbarWindow32` buttons do not carry explicit UIA AutomationIds; the
value reported by Inspect.exe is `""` for all of them. WinAppDriver's `~Name`
selector shorthand resolves against the button's UIA **Name** property (its
visible label), which is documented in the AutomationId column below as the
effective identifier usable with `~`.

| Visual index | Label (KO) | Label (EN) | Control Type | ClassName | AutomationId | `~` selector | Notes |
|---|---|---|---|---|---|---|---|
| 0 | 추가 | Add URL | `Button` | `""` | `""` | `~Add URL` | Opens Enter URL dialog |
| 1 | 시작 | Resume | `Button` | `""` | `""` | `~Resume` | Starts / resumes selected |
| 2 | 중지 | Stop | `Button` | `""` | `""` | `~Stop` | Pauses selected download |
| 3 | 모두중지 | Stop All | `Button` | `""` | `""` | `~Stop All` | Pauses all active downloads |
| 4 | 제거 | Delete | `SplitButton` | `""` | `""` | `~Delete` | Removes selected item |
| 5 | 모두제거 | Delete All | `SplitButton` | `""` | `""` | `""` | Removes all items |
| 6 | 환경설정 | Options | `Button` | `""` | `""` | `~Options` | Opens IDM settings dialog |
| 7 | 예약작업 | Scheduler | `Button` | `""` | `""` | `~Scheduler` | Opens download scheduler |
| 8 | 전송시작 | Resume All | `Button` | `""` | `""` | `~Resume All` | Resumes all paused |
| 9 | 전송중지 | Stop All (2) | `Button` | `""` | `""` | `""` | Secondary stop-all |
| 10 | 소개하기 | About | `Button` | `""` | `""` | `""` | Opens About dialog |

**Indices used by the automation suite:** `TB_START = 1`, `TB_PAUSE = 2`, `TB_DELETE = 4`

---

## 5. Category Tabs (Sidebar Navigation)

IDM displays a vertical category sidebar in the left panel (`Pane[@ClassName="Static"]`).
Clicking a category filters the download list. The sidebar items are Win32 owner-drawn
controls; WinAppDriver exposes them as `ListItem` elements with a `Name` attribute
matching the visible label text.

| Category | Korean label | Control Type | ClassName | AutomationId | XPath selector |
|---|---|---|---|---|---|
| All Downloads | 모든 다운로드 | `ListItem` | `""` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="모든 다운로드"]` |
| Incomplete | 미완료 | `ListItem` | `""` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="미완료"]` |
| Completed | 완료됨 | `ListItem` | `""` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="완료됨"]` |
| Grabber | 그래버 | `ListItem` | `""` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="그래버"]` |
| Queue | 대기열 | `ListItem` | `""` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="대기열"]` |

> **Note:** The exact UIA control type (`ListItem` vs `TreeItem`) depends on the
> IDM version and locale. Verify with Inspect.exe on the target machine. The `Name`
> attribute value shown above was observed on IDM v6.42 KO locale.
>
> The current test suite does not interact with the sidebar; selectors above are
> provided for completeness and future extension.

---

## 6. Add URL Dialog

Clicking the "추가 / Add URL" toolbar button (index 0) opens the **Enter URL**
dialog. It is a standard Win32 modal dialog (`#32770`). The dialog appears as a
child `Window` of the IDM main window in the UIA tree.

### UIA tree (Add URL dialog)

```
Window [ClassName: "#32770", AutomationId: ""]   ← modal dialog
├── Edit   [ClassName: "Edit",   AutomationId: ""]   ← URL text input
├── Button [ClassName: "Button", AutomationId: "", Name: "확인" / "OK"]
└── Button [ClassName: "Button", AutomationId: "", Name: "취소" / "Cancel"]
```

### Control mapping

| Control | Role | Control Type | ClassName | AutomationId | XPath selector |
|---|---|---|---|---|---|
| Dialog window | Modal container | `Window` | `#32770` | `""` | `//Window[@ClassName="#32770"]` |
| URL input | Text entry for download URL | `Edit` | `Edit` | `""` | `//Window[@ClassName="#32770"]//Edit` |
| OK button | Confirms and queues the download | `Button` | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="확인"]` |
| Cancel button | Dismisses the dialog | `Button` | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="취소"]` |

> English-locale IDM uses `"OK"` and `"Cancel"` as button names. The
> `dismissConfirmDialog()` helper in `IdmPage.ts` already tries both `"확인"`
> and `"OK"` (and `"예"` / `"Yes"`) to handle both locales.

---

## 7. Context Menu Structure

Right-clicking a `ListItem` in the download list reveals a context menu.
Menu item text varies by IDM version and current download state.

### Full context menu (typical active download)

```
Start / Start (Resume) / Continue
Stop / Pause / Stop (Pause)
──────────────────────────────
Properties
──────────────────────────────
Copy download link / Copy URL
──────────────────────────────
Open file location / Open folder
──────────────────────────────
Move to category ▶
──────────────────────────────
Remove from list / Remove
Delete
──────────────────────────────
Select All
```

The context menu window has ClassName `#32768` (Win32 floating popup menu).
Menu items are exposed as `MenuItem` elements; their `Name` attribute holds the
visible label text. AutomationId is `""` for all menu items in Win32 menus.

### Engineered selectors (from `IdmPage.ts` SEL object)

| Action | Control Type | AutomationId | Candidate `~` selectors tried in order |
|---|---|---|---|
| Start / Resume active | `MenuItem` | `""` | `~Start`, `~Start (Resume)`, `~Continue`, `~Download` |
| Pause / Stop | `MenuItem` | `""` | `~Stop`, `~Pause`, `~Stop (Pause)`, `~Pause/Stop` |
| Resume paused | `MenuItem` | `""` | `~Start`, `~Start (Resume)`, `~Continue`, `~Resume` |
| Delete (removes file) | `MenuItem` | `""` | `~Delete`, `~Remove` |
| Properties | `MenuItem` | `""` | `~Properties`, `~속성` |
| Copy URL | `MenuItem` | `""` | `~Copy download link`, `~Copy URL`, `~링크 복사`, `~URL 복사` |
| Remove from list | `MenuItem` | `""` | `~Remove from list`, `~Remove`, `~목록에서 제거`, `~대기열에서 제거` |
| Open file location | `MenuItem` | `""` | `~Open file location`, `~Open folder`, `~파일 위치 열기`, `~폴더 열기` |

Each group lists English and Korean variants. `clickContextMenuItem()` uses a
two-phase strategy: Phase 1 tries each `~selector` directly; Phase 2 scans all
`MenuItem` and `Text` elements inside `//Window[@ClassName="#32768"]` and matches
by normalised label substring (handles localisation, ellipsis variants, version
differences).

---

## 8. Key Automation Decisions

### 8.1 Right-click implementation (Task 5)

```typescript
await item.click({ button: 'right' });
```

WebdriverIO's `click({ button: 'right' })` maps to a W3C pointer action, which
Appium forwards as a `rightClick` JSONWP action to WinAppDriver. This is
preferred over `browser.action('pointer').move().down('right').up()` because it
is more concise and works reliably across WinAppDriver v1.2.1.

### 8.2 clearCompleted() scan loop (Task 4 / 10)

Because deleting a `ListItem` shifts all subsequent row indices, a simple
indexed loop would skip or double-click items. The implementation uses a
**restart-on-hit** strategy: after each successful deletion it breaks out of the
inner `for` loop and re-fetches the full item list. The outer `while (found)`
loop exits when a full pass finds no completed rows.

### 8.3 LLM provider — Google Gemini 2.5 Flash

| Property | Value |
|---|---|
| Provider | Google AI Studio |
| Model | `gemini-2.5-flash` |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` |
| Auth | `LLM_API_KEY` environment variable (passed as `?key=` query param) |
| Output format | `responseMimeType: "application/json"` + `responseSchema` (structured output) |
| Timeout | 8-second `Promise.race`; falls back to regex parser on timeout or error |
| SDK | None — native `fetch` to avoid TypeScript compilation conflicts |

### 8.4 No hardcoded pauses

Per project constraints, all UI synchronisation uses `browser.waitUntil()` with
an explicit `timeout` and `interval`. `browser.pause()` is never used.

---

## 9. Supported Agent Commands

| Spoken / typed input | Parsed action | Notes |
|---|---|---|
| "list all downloads" | `list` | Shows full queue |
| "pause ubuntu.iso" | `pause` | Targets by filename |
| "resume the first download" | `resume` | Positional index 0 |
| "start 3rd download" | `start` | Positional index 2 |
| "delete the last item" | `delete` | index −1 = last |
| "clear all completed" | `clear` | Removes all completed rows |
| "완료된 파일들 다 정리해줘" | `clear` | Korean — same effect |
| "두 번째 파일 멈춰줘" | `pause` | Korean + positional |
| "pause first download and delete the second" | `pause` then `delete` | Batch execution |
| "repeat" / "do it again" | _(last command)_ | Memory: re-runs last action |
| "undo" | _(inverted last command)_ | Memory: pause↔resume, start→pause |
