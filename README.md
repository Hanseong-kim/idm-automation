# IDM Desktop Automation + Agentic AI System

**Internet Download Manager (IDM) v6.x** 를 대상으로 한 Windows 데스크톱 UI 자동화 및 자연어 기반 에이전틱 AI 시스템.

WebdriverIO v9 → Appium 2.x → WinAppDriver v1.2.1 스택을 통해 Win32 UIA 트리를 제어하며,  
Google Gemini 2.5 Flash LLM + Regex 이중 파서 구조로 한국어/영어 자연어 명령을 IDM 액션으로 변환한다.

---

## 🧰 Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Test Runner | WebdriverIO | ^9.27.1 |
| Language | TypeScript | ^5.8.3 |
| TS Executor | tsx | ^4.19.4 |
| Desktop Bridge | Appium (appium-windows-driver) | 2.x |
| WinAPI Driver | WinAppDriver | 1.2.1 |
| Test Framework | Mocha (`@wdio/mocha-framework`) | ^9.27.1 |
| LLM Provider | Google Gemini 2.5 Flash | API v1beta |
| Runtime | Node.js | ≥ 18 |

### Protocol Bridge

```
WebdriverIO (W3C)  →  Appium :4724  →  WinAppDriver (JSONWP)  →  Win32 UIA
```

WinAppDriver v1.2.1은 W3C WebDriver 프로토콜을 거부한다. Appium 2.x가 W3C→JSONWP 변환 프록시 역할을 수행하여 두 계층을 연결한다.

---

## 📦 Setup & Installation

### Prerequisites

| 요구사항 | 버전 | 비고 |
|---|---|---|
| Windows | 10 / 11 64-bit | |
| Node.js | ≥ 18 | `node -v` 확인 |
| Internet Download Manager | 6.x | 기본 경로 설치 |
| WinAppDriver | 1.2.1 | 관리자 권한으로 실행 |
| Appium | 2.x | 전역 설치 |

### Install Steps

```powershell
# 1. Appium 전역 설치 (최초 1회)
npm install -g appium

# 2. Appium Windows 드라이버 설치 (최초 1회)
appium driver install windows

# 3. 프로젝트 의존성 설치
npm install

# 4. LLM API 키 설정 (선택 — 없어도 Regex 파서로 동작)
# 프로젝트 루트에 .env 파일 생성:
# LLM_API_KEY=your_google_ai_studio_key
```

> `LLM_API_KEY` 미설정 시 Gemini LLM 호출을 건너뛰고 내장 Regex 파서만 사용한다.  
> 테스트와 에이전트의 핵심 기능은 API 키 없이도 완전히 동작한다.

---

## 🏃 How to Run

### UI 자동화 테스트 (Mocha E2E)

```powershell
npm run wdio
```

- `@wdio/appium-service` 가 Appium을 포트 4724에서 자동 기동/종료한다.
- WinAppDriver는 별도로 관리자 권한 실행 상태여야 한다.
- IDM에 다운로드 항목이 없으면 인터랙션 테스트는 `SKIPPED(-)` 로 정상 마킹된다 (false-positive 없음).

**IDM 큐가 빈 상태의 기대 출력:**

```
NL Parser — unit tests
  ✓ parses "list all downloads"
  ✓ parses "pause the first download"
  ... (10 passing)

IDM Agent — NL command execution
  ✓ should list all downloads via natural language
  - should pause the first download via natural language   (skipped)
  - should resume the first paused download via natural language   (skipped)
  ✓ should handle an unknown filename gracefully

LLM Parser — parseCommand unit tests
  ✓ parses Korean conversational pause: "야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?"
  ... (7 passing)

IDM — UI Automation
  ✓ should launch IDM and verify the main window is accessible
  ✓ should extract downloads and print structured data
  - should pause the first active download   (skipped)
  ...

Spec Files: 2 passed, 2 total
```

### 에이전트 REPL 실행

```powershell
npm run start:agent
```

IDM에 Appium 세션을 연결하고 대화형 자연어 명령 루프(REPL)를 시작한다.

```
Agent > list all downloads
[Result] ✓ Listed 3 download(s).

Agent > pause ubuntu.iso
[AI Intent] Action: pause, Target: ubuntu.iso
[Result] ✓ "ubuntu.iso" paused successfully.

Agent > pause first download and delete the last
[Batch] → "pause first download"
[Result] ✓ "ubuntu.iso" paused successfully.
[Batch] → "delete the last"
[Result] ✓ "debian.iso" deleted successfully.

Agent > undo
[Agent] Cannot undo "delete" — this action is irreversible.

Agent > repeat
[Agent] Repeating: delete "debian.iso"
...

Agent > exit
```

**지원 명령어:**

| 유형 | 영어 예시 | 한국어 예시 |
|---|---|---|
| 목록 조회 | `list all downloads` | `다운로드 목록 보여줘` |
| 일시정지 | `pause ubuntu.iso` | `우분투 파일 멈춰줘` |
| 재개 | `resume the second download` | `두 번째 파일 다시 시작해줘` |
| 시작 | `start first download` | `첫 번째 다운로드 시작해` |
| 삭제 | `delete the last item` | `맨 마지막 꺼 취소해` |
| 완료 정리 | `clear all completed` | `완료된 파일들 다 정리해줘` |
| 반복 | `repeat` / `do it again` | — |
| 되돌리기 | `undo` (pause↔resume, start→pause) | — |
| 배치 실행 | `pause first and delete the second` | `첫 번째 멈추고 두 번째 삭제해` |

---

## 🤖 Agentic AI Architecture

### 전체 파이프라인

```
User Input (EN / KO)
        │
        ▼
┌──────────────────────────────────────────────────┐
│              parseCommand(text)                  │
│                                                  │
│  ┌───────────────────────────┐                   │
│  │  Gemini 2.5 Flash (LLM)  │  ← LLM_API_KEY    │
│  │  structured JSON output  │    필요             │
│  │  timeout: 8 s            │                   │
│  └────────────┬─────────────┘                   │
│               │ 실패 · 타임아웃 · 키 없음           │
│               ▼                                  │
│  ┌───────────────────────────┐                   │
│  │  Regex Fallback Parser   │  ← 항상 동작        │
│  │  parseNaturalLanguage()  │                   │
│  └───────────────────────────┘                   │
└──────────────────────────────────────────────────┘
        │
        ▼
  IdmCommand { action, target, index? }
        │
        ▼
  resolveTarget()  →  DownloadItem[]
        │
        ▼
  IdmPage.pauseDownload() / startDownload() / ...
        │
        ▼
  waitForStatusChange()  →  CommandResult
```

### Hybrid Fail-safe Fallback

Gemini API Free Tier는 분당 5회 요청 제한이 있으며 429(Quota Exceeded), 503(Unavailable) 오류가 발생할 수 있다. 다음 4가지 경로에서 모두 Regex 파서로 자동 전환된다:

```typescript
// src/agent/nlParser.ts — parseCommand()
const llmResult = await Promise.race([
    parseWithLLM(text),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
]);
if (llmResult) return llmResult;        // LLM 성공
return parseNaturalLanguage(text);      // 모든 실패 경우 → Regex 폴백
```

| 조건 | 동작 |
|---|---|
| `LLM_API_KEY` 미설정 | LLM 호출 즉시 건너뜀, Regex 파서 실행 |
| API 429 / 503 에러 | 경고 로그 출력 후 Regex 폴백 |
| 8초 타임아웃 | `Promise.race` null 반환 → Regex 폴백 |
| LLM JSON 스키마 불일치 | `isValidIdmCommand()` 실패 → Regex 폴백 |

### Command Schema (`src/agent/types.ts`)

```typescript
interface IdmCommand {
    action: 'start' | 'pause' | 'resume' | 'delete' | 'list' | 'clear';
    target: string;   // 파일명 substring 또는 '*' (전체 와일드카드)
    index?: number;   // 0-based 위치; -1 = 마지막
}
```

### Smart Target Resolution (`src/agent/targetResolver.ts`)

| 우선순위 | 전략 | 예시 입력 | 처리 방식 |
|---|---|---|---|
| 1 | 명시적 인덱스 | `"first"`, `"3rd"`, `"last"` | `index=0`, `index=2`, `index=-1` |
| 2 | 와일드카드 | `target="*"` | 전체 `downloads[]` 반환 |
| 3 | 상태 기반 필터 | `target="completed"` | `status` 필드 포함 항목 필터 |
| 4 | 파일명 substring | `target="ubuntu"` | `"ubuntu.iso"` 매칭 |

### Command Memory (`src/main.ts`)

```typescript
const commandHistory: IdmCommand[] = [];

const UNDO_MAP: Partial<Record<ActionType, ActionType>> = {
    pause: 'resume',
    resume: 'pause',
    start: 'pause',
};
```

- **repeat**: 마지막 성공 커맨드 재실행
- **undo**: UNDO_MAP 기반 역액션 (`delete` / `clear` / `list` 는 비가역)
- **배치 실행**: `and` / `then` 구분자로 순차 실행, 하나 실패해도 나머지 계속 진행

---

## 🗂️ Project Structure

```
idm-automation/
├── src/
│   ├── main.ts                  ← 에이전트 REPL (배치 / memory / undo)
│   └── agent/
│       ├── types.ts             ← IdmCommand, DownloadItem, CommandResult
│       ├── nlParser.ts          ← Gemini LLM + Regex 이중 파서
│       ├── dispatcher.ts        ← IdmCommand → IdmPage 함수 매핑
│       └── targetResolver.ts    ← 스마트 타깃 해석
├── test/
│   ├── pageobjects/
│   │   └── IdmPage.ts           ← IDM Win32 UIA 페이지 오브젝트
│   └── specs/
│       ├── test.e2e.ts          ← UI 자동화 계층 테스트 (Tasks 3–5)
│       └── agent.e2e.ts         ← 에이전트 계층 테스트 (Tasks 9–14)
├── wdio.conf.ts                 ← WebdriverIO + Appium 세션 설정
├── tsconfig.json                ← strict / noUnusedLocals / noUnusedParameters
├── package.json
└── REPORT.md                    ← IDM UI 분석 보고서 (Tasks 1–2)
```

---

## ⚙️ Configuration

### Appium Session (`wdio.conf.ts`)

```typescript
capabilities: [{
    platformName: 'Windows',
    'appium:automationName': 'Windows',
    'appium:app': 'C:\\Program Files (x86)\\Internet Download Manager\\IDMan.exe',
    'appium:appWorkingDir': 'C:\\Program Files (x86)\\Internet Download Manager',
    'appium:newCommandTimeout': 3600,
} as WebdriverIO.Capabilities]
```

### TypeScript (`tsconfig.json`)

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true,
  "ignoreDeprecations": "6.0"
}
```

---

## 🛡️ Design Constraints

| 제약 | 구현 방식 |
|---|---|
| `browser.pause()` 금지 | 모든 UI 동기화에 `browser.waitUntil()` 사용 |
| 좌표 기반 클릭 금지 | XPath / UIA Name 속성 기반 element 선택만 허용 |
| 파일 확장자 보존 | `extractTarget()` 에서 `.` 을 제거하지 않음 (`ubuntu.iso` 보존) |
| Stale Element 방어 | `withRetry(maxAttempts=3)` 및 매 폴링마다 element 재조회 |
