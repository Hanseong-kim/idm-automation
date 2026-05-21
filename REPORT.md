# IDM UI Analysis Report

**Project:** idm-automation  
**Target Application:** Internet Download Manager (IDM) v6.42  
**Automation Stack:** WebdriverIO v9 → Appium 2.x (appium-windows-driver) → WinAppDriver v1.2.1  
**Report Date:** 2026-05-21  
**Inspection Tools:** Windows Inspect.exe (Windows SDK), Accessibility Insights for Windows, WinAppDriver `getPageSource()`

---

## 1. Application Window Analysis

### Main Window

| Property | Value |
|---|---|
| Process | `IDMan.exe` |
| Install Path | `C:\Program Files (x86)\Internet Download Manager\IDMan.exe` |
| Working Directory | `C:\Program Files (x86)\Internet Download Manager` |
| UIA Window Title (Name) | `"Internet Download Manager 6.42"` (버전 문자열 동적 포함) |
| Window Class | `IEFrame` |
| AutomationId | `""` (Win32 네이티브 최상위 창 — AutomationId 없음) |

**타이틀 탐지 전략:** 버전 접미사가 동적으로 변경되므로 exact-match selector 대신 `browser.getTitle()` 반환값의 포함 여부를 확인한다:

```typescript
const title = await browser.getTitle();
return title.toLowerCase().includes('internet download manager');
```

### Dialog Windows

| 다이얼로그 | 용도 | Window Class | 열기 방법 |
|---|---|---|---|
| Add URL | URL 입력 및 다운로드 추가 | `#32770` | 툴바 "추가" 버튼 (index 0) |
| Options | IDM 환경설정 | `#32770` | 툴바 "환경설정" 버튼 (index 6) |
| Scheduler | 예약 작업 관리 | `#32770` | 툴바 "예약작업" 버튼 (index 7) |
| Confirm Delete | 삭제 확인 | `#32770` | 삭제 액션 후 자동 출현 |
| Context Menu | 우클릭 팝업 메뉴 | `#32768` | ListItem 우클릭 |

---

## 2. Window Class Hierarchy (UIA Tree)

```
Window [ClassName: IEFrame, AutomationId: ""]                  ← 세션 루트 / 앱 프레임
└── Pane [ClassName: IDMMainWindow, AutomationId: ""]          ← 메인 클라이언트 영역
    ├── ToolBar [ClassName: ToolbarWindow32, AutomationId: ""] ← 메인 툴바
    │   ├── Button  [Name: "추가",    AutomationId: ""]        ← index 0
    │   ├── Button  [Name: "시작",    AutomationId: ""]        ← index 1  (TB_START)
    │   ├── Button  [Name: "중지",    AutomationId: ""]        ← index 2  (TB_PAUSE)
    │   ├── Button  [Name: "모두중지",AutomationId: ""]        ← index 3
    │   ├── SplitButton [Name: "제거",AutomationId: ""]        ← index 4  (TB_DELETE)
    │   ├── SplitButton [Name: "모두제거",AutomationId: ""]    ← index 5
    │   ├── Button  [Name: "환경설정",AutomationId: ""]        ← index 6
    │   ├── Button  [Name: "예약작업",AutomationId: ""]        ← index 7
    │   ├── Button  [Name: "전송시작",AutomationId: ""]        ← index 8
    │   ├── Button  [Name: "전송중지",AutomationId: ""]        ← index 9
    │   └── Button  [Name: "소개하기",AutomationId: ""]        ← index 10
    ├── Pane [ClassName: Static, AutomationId: ""]             ← 카테고리 사이드바
    │   ├── ListItem [Name: "모든 다운로드", AutomationId: ""]
    │   ├── ListItem [Name: "미완료",        AutomationId: ""]
    │   ├── ListItem [Name: "완료됨",        AutomationId: ""]
    │   ├── ListItem [Name: "그래버",        AutomationId: ""]
    │   └── ListItem [Name: "대기열",        AutomationId: ""]
    └── List [ClassName: SysListView32, AutomationId: ""]      ← 다운로드 큐
        ├── ListItem [AutomationId: ""]                        ← 다운로드 행 1
        │   ├── Text (col 1: 파일명)
        │   ├── Text (col 2: 빈값 / URL)
        │   ├── Text (col 3: 파일 크기)
        │   └── Text (col 4: 상태)
        └── ...
```

> UIA 트리는 Windows Inspect.exe 및 WinAppDriver `browser.getPageSource()` XML 덤프로 매핑함.  
> `SysListView32` 와 `ToolbarWindow32` 클래스명만 테스트 스위트의 XPath에 의존한다.

---

## 3. UI Control Mapping

### 3-1. Toolbar Buttons

Win32 `ToolbarWindow32` 버튼은 UIA AutomationId가 비어 있다. WinAppDriver의 `~Name` 셀렉터는 UIA **Name** 속성(버튼 레이블)으로 해석된다.

자동화 스위트는 `//ToolBar/*[self::Button or self::SplitButton]` 유니온 XPath로 모든 인터랙티브 요소를 인덱싱한다. `Button` 과 `SplitButton` 이 혼재하므로 `//ToolBar//Button` 만 사용하면 인덱스가 어긋난다.

| Visual Index | 한국어 레이블 | 영어 레이블 | Control Type | AutomationId | `~` Selector | 비고 |
|---|---|---|---|---|---|---|
| 0 | 추가 | Add URL | `Button` | `""` | `~Add URL` | URL 입력 다이얼로그 |
| 1 | 시작 | Resume | `Button` | `""` | `~Resume` | **TB_START** — 선택 항목 시작/재개 |
| 2 | 중지 | Stop | `Button` | `""` | `~Stop` | **TB_PAUSE** — 선택 항목 일시정지 |
| 3 | 모두중지 | Stop All | `Button` | `""` | `~Stop All` | 전체 정지 |
| 4 | 제거 | Delete | `SplitButton` | `""` | `~Delete` | **TB_DELETE** — 선택 항목 제거 |
| 5 | 모두제거 | Delete All | `SplitButton` | `""` | `""` | 전체 제거 |
| 6 | 환경설정 | Options | `Button` | `""` | `~Options` | 설정 다이얼로그 |
| 7 | 예약작업 | Scheduler | `Button` | `""` | `~Scheduler` | 스케줄러 |
| 8 | 전송시작 | Resume All | `Button` | `""` | `~Resume All` | 전체 재개 |
| 9 | 전송중지 | Stop All (2) | `Button` | `""` | `""` | 보조 전체 정지 |
| 10 | 소개하기 | About | `Button` | `""` | `""` | About 다이얼로그 |

**스위트 사용 인덱스:** `TB_START = 1`, `TB_PAUSE = 2`, `TB_DELETE = 4`

### 3-2. Download List (SysListView32)

| Attribute | Value |
|---|---|
| UIA Control Type | `List` |
| ClassName | `SysListView32` |
| AutomationId | `""` |
| XPath Selector | `//List[@ClassName="SysListView32"]` |
| Child Control Type | `ListItem` (다운로드 행 1개) |
| Child AutomationId | `""` |

**컬럼 레이아웃 (1-based XPath Text[N] — WinAppDriver UI Tree Dump 기준):**

| 상수 | XPath Index | 컬럼 내용 | UIA Child Selector |
|---|---|---|---|
| `COL_FILENAME = 1` | 1 | 파일명 | `.//Text[1]` |
| _(empty)_ | 2 | 빈값 / URL | `.//Text[2]` (스킵) |
| `COL_SIZE = 3` | 3 | 파일 크기 | `.//Text[3]` |
| `COL_STATUS = 4` | 4 | 다운로드 상태 | `.//Text[4]` |

> **중요:** 실제 UI Dump 결과 `Text[2]` 는 활성 다운로드에서 빈 문자열이다.  
> `Text[3]` 이 파일 크기, `Text[4]` 가 상태 문자열이다.  
> 이는 WDIO 보일러플레이트 기본값(Text[2]=크기, Text[3]=상태)과 다르며, 상수로 관리한다.

**Name 속성 폴백 포맷 (Text[N] 접근 불가 시):**

```
ubuntu.iso
ubuntu.iso\t1.2 GB\tDownloading\t45%
ubuntu.iso, 1.2 GB, Downloading, 45%
```

`parseIdmItemName()` 이 `\t` 또는 `,\s+` 로 분리하여 두 포맷을 모두 처리한다.

**알려진 상태 문자열:**

| 상태 | 영어 | 한국어 |
|---|---|---|
| 활성 | `Downloading`, `Connecting`, `In progress`, `Resuming` | `다운로드 중`, `연결 중` |
| 일시정지 | `Paused`, `Stopped`, `Queued`, `Scheduled` | `일시정지`, `중지`, `대기` |
| 완료 | `Completed`, `Done`, `Finished`, `100%` | `완료` |
| 오류 | `Error`, `Failed`, `Virus detected` | |

### 3-3. Category Tabs (Sidebar)

IDM 왼쪽 패널의 카테고리 사이드바. `Pane[@ClassName="Static"]` 내 Win32 owner-drawn 컨트롤이 `ListItem` 으로 노출된다.

| 카테고리 | 한국어 레이블 | Control Type | AutomationId | XPath Selector |
|---|---|---|---|---|
| All Downloads | 모든 다운로드 | `ListItem` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="모든 다운로드"]` |
| Incomplete | 미완료 | `ListItem` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="미완료"]` |
| Completed | 완료됨 | `ListItem` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="완료됨"]` |
| Grabber | 그래버 | `ListItem` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="그래버"]` |
| Queue | 대기열 | `ListItem` | `""` | `//Pane[@ClassName="Static"]//ListItem[@Name="대기열"]` |

### 3-4. Add URL Dialog

툴바 "추가" 버튼(index 0) 클릭 시 나타나는 표준 Win32 모달 다이얼로그(`#32770`).

```
Window [ClassName: "#32770", AutomationId: ""]      ← 모달 다이얼로그
├── Edit   [ClassName: "Edit",   AutomationId: ""]   ← URL 텍스트 입력
├── Button [ClassName: "Button", Name: "확인" / "OK"]
└── Button [ClassName: "Button", Name: "취소" / "Cancel"]
```

| 컨트롤 | 역할 | ClassName | AutomationId | XPath Selector |
|---|---|---|---|---|
| 다이얼로그 창 | 모달 컨테이너 | `#32770` | `""` | `//Window[@ClassName="#32770"]` |
| URL 입력 | 다운로드 URL 입력 | `Edit` | `""` | `//Window[@ClassName="#32770"]//Edit` |
| 확인 버튼 | 다운로드 큐에 추가 | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="확인"]` |
| 취소 버튼 | 다이얼로그 닫기 | `Button` | `""` | `//Window[@ClassName="#32770"]//Button[@Name="취소"]` |

### 3-5. Context Menu

`ListItem` 우클릭 시 나타나는 Win32 팝업 메뉴 (`#32768`). `MenuItem` 요소의 `Name` 속성이 레이블 텍스트를 담는다.

| 액션 | Candidate `~` Selectors (순서대로 시도) |
|---|---|
| 시작 / 재개 | `~Start`, `~Start (Resume)`, `~Continue`, `~Download` |
| 일시정지 | `~Stop`, `~Pause`, `~Stop (Pause)`, `~Pause/Stop` |
| 삭제 | `~Delete`, `~Delete...`, `~Remove`, `~삭제`, `~제거` |
| 속성 | `~Properties`, `~속성` |
| URL 복사 | `~Copy download link`, `~Copy URL`, `~링크 복사`, `~URL 복사` |
| 목록에서 제거 | `~Remove from list`, `~Remove`, `~목록에서 제거`, `~대기열에서 제거` |
| 파일 위치 열기 | `~Open file location`, `~Open folder`, `~파일 위치 열기`, `~폴더 열기` |

---

## 4. Automation Implementation Notes

### 4-1. Toolbar 버튼 접근 방식

Win32 `ToolbarWindow32` 버튼은 `Button` 과 `SplitButton` 이 혼재한다. `//ToolBar//Button` 만으로는 `SplitButton` 이 제외되어 인덱스가 어긋난다. 유니온 XPath로 해결:

```typescript
const buttons = await $$('//ToolBar/*[self::Button or self::SplitButton]') as unknown as WebdriverIO.Element[];
const btn = buttons[index];
await btn.click();
```

### 4-2. 우클릭 구현

```typescript
await item.click({ button: 'right' });
```

WebdriverIO의 `click({ button: 'right' })` 는 W3C Pointer Action으로 매핑된다. Appium이 이를 WinAppDriver `rightClick` JSONWP 액션으로 변환한다.

### 4-3. clearCompleted() 재시작 전략

ListView 항목 삭제 시 이후 모든 행의 인덱스가 시프트된다. 단순 순회 루프는 항목 스킵 또는 이중 클릭을 유발한다. 이를 방지하기 위해 **restart-on-hit** 전략을 사용한다:

```typescript
while (found) {
    found = false;
    const items = await this.getListItems();          // 매 패스마다 전체 목록 재조회
    for (let i = 0; i < items.length; i++) {
        const status = await this.getItemStatus(items[i]);
        if (COMPLETED_STATUSES.some(s => status.includes(s))) {
            await items[i].click();
            await this.clickToolbarButton(SEL.TB_DELETE);
            await this.dismissConfirmDialog();
            cleared++;
            found = true;
            break;   // 인덱스 시프트 발생 → 외부 루프에서 목록 재조회
        }
    }
}
```

### 4-4. 컨텍스트 메뉴 2단계 Self-Healing

**Phase 1 (빠른 경로):** 각 `~selector` 를 직접 시도한다 (locale-specific, version-specific).

**Phase 2 (Self-Healing):** Phase 1 전체 실패 시 `//Window[@ClassName="#32768"]` 내 모든 `MenuItem` 과 `Text` 요소를 스캔하여 정규화된 레이블 substring 매칭을 수행한다:

```typescript
const norm = (s: string) =>
    s.replace(/^~/, '').toLowerCase().replace(/\.\.\./g, '').replace(/\s+/g, ' ').trim();
```

이 방식은 로케일 차이, 말줄임표 변형, 버전별 레이블 차이를 모두 수용한다.

---

## 5. Robust Element Handling & Synchronization

### 5-1. withRetry — Stale Element 방어

Win32 UIA 트리는 IDM이 다운로드 목록을 갱신할 때 element reference가 무효화(Stale)된다. `withRetry` 는 지수 백오프로 최대 3회 재시도한다:

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
            // 300 ms → 600 ms 백오프
        }
    }
    throw lastError;
}
```

`setTimeout` 을 사용하는 이유: `browser.pause()` 는 프로젝트 제약상 금지되어 있다. `setTimeout` 은 Node.js 런타임 레벨의 인프라 지연이므로 제약을 위반하지 않는다.

### 5-2. getLiveStatus — 매 폴링 element 재조회

`waitForStatusChange()` 는 이전에 `item.getAttribute('Name')` 을 폴링했는데, 이는 두 가지 문제를 가진다:

1. **Stale reference**: 캡처된 element 객체가 UIA 갱신 시 무효화됨
2. **잘못된 컬럼**: `Name` 속성은 파일명만 담으며, 상태 문자열을 신뢰성 있게 포함하지 않음

현재 구현은 매 폴링마다 `getLiveStatus(index)` 를 호출하여 element 목록을 새로 조회하고 `Text[COL_STATUS]` 컬럼을 직접 읽는다:

```typescript
private async waitForStatusChange(index: number, expectedStatuses: string[]): Promise<void> {
    const lower = expectedStatuses.map(s => s.toLowerCase());
    await browser.waitUntil(
        async () => {
            try {
                const status = await this.getLiveStatus(index); // 매 500ms 마다 재조회
                return lower.some(s => status.includes(s));
            } catch {
                return false;
            }
        },
        { timeout: 10000, interval: 500 }
    );
}

private async getLiveStatus(index: number): Promise<string> {
    const items = await this.getListItems();  // 전체 목록 재조회
    const item = items[index];
    if (!item) throw new Error(`No list item at index ${index}.`);
    return this.getItemStatus(item);          // Text[COL_STATUS] 읽기
}
```

### 5-3. Pre-condition Guards — 불필요한 액션 방지

각 인터랙션 함수는 실행 전 현재 상태를 확인하여 의미없는 액션과 10초 타임아웃을 방지한다:

| 함수 | Guard 조건 | 예외 메시지 |
|---|---|---|
| `startDownload` | 이미 완료 상태 | `"FAILED: Cannot start ... — it is already completed."` |
| `pauseDownload` | 이미 완료 상태 | `"FAILED: Cannot pause ... — it is already completed."` |
| `pauseDownload` | 이미 일시정지 상태 | `"FAILED: Cannot pause ... — it is already paused/stopped."` |
| `resumeDownload` | 이미 완료 상태 | `"FAILED: Cannot resume ... — it is already completed."` |

### 5-4. Mocha this.skip() — False-Positive 방지

다운로드 항목이 없는 환경에서 인터랙션 테스트를 조건부로 건너뛸 때, 단순 `return` 은 Mocha에서 **PASSED** 로 잘못 기록된다. `function()` 콜백과 `this.skip()` 을 조합하여 **SKIPPED(-)** 로 정확히 마킹한다:

```typescript
// ❌ 잘못된 방식 — Mocha가 PASSED로 기록
it('test name', async () => {
    if (!condition) return;
    ...
});

// ✅ 올바른 방식 — Mocha가 SKIPPED(-)로 기록
it('test name', async function () {
    if (!condition) return this.skip();
    ...
});
```

화살표 함수(`async () =>`) 는 Mocha의 `this` 컨텍스트를 바인딩하지 않으므로 `this.skip()` 을 사용하려면 반드시 `function()` 콜백이어야 한다.

---

## 6. Agent Command Parsing

### Supported Commands (Regex Fallback 기준)

| 자연어 입력 | 파싱 결과 | 비고 |
|---|---|---|
| `"list all downloads"` | `{action:"list", target:"*"}` | |
| `"pause ubuntu.iso"` | `{action:"pause", target:"ubuntu.iso"}` | 파일 확장자 `.` 보존 |
| `"pause the first download"` | `{action:"pause", target:"*", index:0}` | |
| `"resume the second"` | `{action:"resume", target:"*", index:1}` | |
| `"delete the last item"` | `{action:"delete", target:"*", index:-1}` | |
| `"start 3rd download"` | `{action:"start", target:"*", index:2}` | |
| `"clear all completed"` | `{action:"clear", target:"*"}` | |
| `"delete completed files"` | `{action:"clear", target:"*"}` | `delete\s*completed` → clear |
| `"야 나 어제 받던 우분투 파일 잠깐 멈춰줄래?"` | `{action:"pause", target:"우분투"}` | LLM 처리 |
| `"완료된 파일들 다 정리해줘"` | `{action:"clear", target:"*"}` | |
| `"두 번째 파일 멈춰줘"` | `{action:"pause", target:"*", index:1}` | `멈춰` 패턴 포함 |
| `"맨 마지막에 받기 시작한 거 취소해"` | `{action:"delete", target:"*", index:-1}` | |

### LLM Provider Configuration

| Property | Value |
|---|---|
| Provider | Google AI Studio |
| Model | `gemini-2.5-flash` |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent` |
| Auth | `LLM_API_KEY` 환경 변수 (`?key=` 쿼리 파라미터) |
| Output Format | `responseMimeType: "application/json"` + `responseSchema` (구조화 출력) |
| Timeout | 8초 `Promise.race`; 초과 시 Regex 파서 폴백 |
| SDK | 없음 — 타입 충돌 방지를 위해 native `fetch` 직접 사용 |
