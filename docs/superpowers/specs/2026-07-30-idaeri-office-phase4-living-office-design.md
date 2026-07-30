# 이대리 macOS 콘솔 Phase 4 (살아있는 오피스) — 설계

## 배경

이대리 macOS 콘솔은 Phase 3(PR #159)에서 "오피스" 탭을 얻었다. `agent-registry` 전원을 SpriteKit 씬에 5열 격자로 배치하고, 각 에이전트를 상태색 원 + 이름 라벨로 표시하는 **정적 배치 스파이크**였다. 캐릭터 이동·연출·지시 상호작용·말풍선은 Phase 3에서 의도적으로 범위 밖으로 남겨졌다(Phase 3 설계 §범위 밖).

이 오피스 탭의 원형은 "나만의 AI 회사 만들기 · 심화편" 가이드다. 코드의 상태 팔레트 주석("Notion 심화편 팔레트")과 상태 5종 색·`bubble`(말풍선) 필드가 그 가이드와 1:1로 대응한다. 가이드는 자신의 실패담에서 **"직원이 자리에서 색깔만 바뀌는 대시보드"**를 1차 시도로 규정하고("숫자는 맞는데 안 궁금해서 하루 만에 안 보게 됐다"), 그 원인을 "직원에게 좌표가 없었다"로 진단한 뒤, 좌표·상태·말풍선을 넣어 "살아있는 오피스"로 만든 2차 시도를 처방한다.

현재 이대리 오피스 탭은 정확히 그 1차 시도 상태다. Phase 4는 이를 2차 시도로 끌어올린다. 단, 가이드의 가상 직원은 AI가 롤플레이하는 인물이고 "하루 12단계"는 스크립트 재생이지만, 이대리 에이전트는 실제로 코드 에이전트(codex)를 호출해 PR을 만들고 리뷰하는 실 일꾼이다. 따라서 Phase 4는 가이드의 연출을 **실제 run/approval/chain 데이터에 입힌다** — 가짜 시나리오 재생이 아니다.

## 관통 제약 (불변)

- Swift 앱에 LLM 로직 없음. 지능은 전부 백엔드(구독 CLI). 유료 API 경로 도입 금지.
- 백엔드는 로컬 Mac localhost 유지.
- 콘솔 write는 Phase 2A에서 도입된 기존 경로(`sendCommand`/`approve`/`reject`)만 재사용한다. **새 네트워크·API 경로를 만들지 않는다.**
- 빌드·검증은 `swift build` / 실행형 테스트 러너(`swift run ConsoleCoreTests`). 이 환경은 CLT만 있고 Xcode(`xcodebuild`)·XCTest가 없다.
- 순수 계산(이동 목적지·연출 매핑·히트테스트·승인 매칭)은 `ConsoleCore`에 두어 실행형 러너로 테스트한다. SpriteKit 의존 코드(`OfficeScene`의 `SKAction`·히트테스트 바인딩)는 실행 타깃 `IdaeriConsole`에 둔다.
- 데이터는 Phase 1의 `ConsoleStore`(스냅샷 + SSE) 그대로 재사용한다.

## 목표와 성공 기준

오피스 탭을 정적 격자에서 **상태가 살아 움직이는 관제 화면**으로 확장한다. 격자 자리는 유지하되, 실 이벤트에 반응해 연출하고, 클릭으로 지시·승인을 보낸다. 성공 기준:

1. 진행 중인 에이전트는 노랑 + 타이핑 펄스로 "일하는 중"임이 눈에 보인다.
2. 승인 대기가 열리면 해당 원이 핑크로 깜빡이며 상단 "대표실 밴드"로 직선 이동해 집결하고, 승인/거절 후 자기 자리로 복귀한다.
3. 체인 실행(부모→자식 핸드오프)이 일어나면 부모 자리에서 자식 자리로 이동 연출이 보인다.
4. 에이전트 원을 클릭하면 그 에이전트에게 지시를 보낼 수 있고(기존 `sendCommand` 재사용), 승인 대기 원을 클릭하면 승인/거절할 수 있다.
5. 위 연출·상호작용을 뒷받침하는 순수 계산(이동 목적지·이벤트→연출 매핑·히트테스트·승인 매칭)이 실행형 러너로 검증된다.

## 아키텍처

Phase 3의 경계를 그대로 계승한다. **순수 로직은 `ConsoleCore`, SpriteKit 연출(`SKAction`)·클릭 바인딩은 `IdaeriConsole`.**

- **연출 트리거의 원천은 SSE 이벤트다.** 상태 스냅샷(`agents`)은 "현재 무슨 색"만 알려주지, "방금 무슨 일이 일어났는가"를 알려주지 않는다. 연출은 변화(run 시작·종료, approval 열림·닫힘, 상태 전이, 명령 거절)에 반응해야 하므로, `ConsoleStore`가 처리한 최신 이벤트를 뷰가 관측할 수 있게 노출한다(예: `@Published` 최신 이벤트 또는 Combine 방출). `OfficeView`가 이를 구독해 `VisualIntent`로 변환하고 `OfficeScene`에 전달한다.
- **`OfficeScene`** (확장): 기존 노드 생성·색 갱신에 더해, `VisualIntent` 배열을 받아 `SKAction`으로 실행한다. `mouseDown` 히트테스트로 클릭된 `agentType`을 콜백으로 올린다. 씬은 "지금 무엇을 하라"는 명령만 받는다 — 어떤 이벤트가 어떤 연출인지는 순수 매핑이 결정한다.
- **`OfficeView`** (확장): `store.agents`뿐 아니라 최신 이벤트·`approvals`·`pendingCommands`도 관측한다. 이벤트를 `VisualIntent`로 매핑해 씬에 넘기고, 씬의 클릭 콜백을 상위(`AppRootView`)의 write 액션에 연결한다. 클릭 시 지시 입력 바 / 승인·거절 팝오버를 띄운다.
- **`AppRootView`** (재사용): 기존 `sendCommand`/`approve`/`reject`를 `OfficeView`에도 주입한다(대시보드와 동일 경로). 신규 write 로직 없음.

## 컴포넌트

| 컴포넌트 | 위치 | 역할 | 의존 |
|---|---|---|---|
| `VisualIntent` | `Sources/ConsoleCore/` | 연출 의도 값 타입(열거형). 이벤트를 씬 명령으로 번역한 결과 | 없음 |
| `visualIntents(for:agents:)` | `Sources/ConsoleCore/` | `ConsoleEvent` + 현재 에이전트 → `[VisualIntent]`. **순수 함수** | `ConsoleEvent`, `ConsoleAgent` |
| `officeLayout(...)` (확장) | `Sources/ConsoleCore/` | 격자 자리 계산에 "대표실 밴드" 높이를 반영(격자 영역을 하단으로 압축) | 없음 |
| `presidentBandSlot(order:...)` | `Sources/ConsoleCore/` | 집결 순번 → 대표실 밴드 내 좌표. **순수 함수** | 없음 |
| `agentTypeAt(point:positions:radius:)` | `Sources/ConsoleCore/` | 클릭 좌표 → 해당 `agentType`(히트테스트). **순수 함수** | 없음 |
| `approvalFor(agentType:in:)` | `Sources/ConsoleCore/` | 에이전트 → 그 에이전트의 승인 대기 건. **순수 함수** | `ConsoleApproval` |
| `OfficeScene` (확장) | `Sources/IdaeriConsole/` | `VisualIntent` 실행(`SKAction`), `mouseDown` 히트테스트 콜백 | 위 순수 함수, `skColor` |
| `OfficeView` (확장) | `Sources/IdaeriConsole/` | 이벤트→intent 변환, 씬 배선, 클릭→지시/승인 UI | `ConsoleStore`, `OfficeScene` |

`VisualIntent`와 매핑을 `ConsoleCore`에 두는 이유는 Phase 3의 `officeLayout`과 같다 — 순수 계산이라 SpriteKit 없이 실행형 러너에서 검증된다. 씬은 "결정된 연출을 그리기"만 한다.

## 공간 레이아웃 — 대표실 밴드

직선 이동에는 목적지가 필요하다. 현재 격자는 씬 전체를 채우므로, 격자 영역을 **하단(약 78%)으로 압축**하고 상단에 가로 **대표실/집결 밴드**를 둔다.

```
┌──────────── 대표실 밴드 (집결지) ────────────┐
│   승인 대기·소집된 원이 여기로 직선 이동        │
├──────────────────────────────────────────────┤
│  [PM]  [BE]  [CodeRev] [WorkRev] [Impact]     │   ← 각자 자리(격자)
│  [POsh][Schema][Test]  [SRE]    [Fix]   ...   │
└──────────────────────────────────────────────┘
```

- 각 에이전트의 "집(home) 자리"는 확장된 `officeLayout`이 계산한다(밴드 높이만큼 격자가 하단으로 밀림).
- 집결 목적지는 `presidentBandSlot`이 순번대로 밴드 안에 나열한다.
- 연출이 끝나면 원은 자기 집 자리로 복귀한다.
- 회의실 전용 공간·타일맵은 이 밴드로 대체한다(범위 밖 유지).

## 연출 사전 (이벤트 → VisualIntent → SKAction)

`visualIntents(for:agents:)`가 SSE 이벤트를 아래 의도로 번역하고, `OfficeScene`이 각 의도를 `SKAction`으로 실행한다.

| store 이벤트 | VisualIntent | 씬 연출(SKAction) |
|---|---|---|
| `run.started` (parentId 없음) | `.working(agentType)` | 노랑 트윈 + 타이핑 펄스(scaleY 반복) |
| `run.started` (parentId 있음) | `.handoff(from, to)` | 부모 자리→자식 자리 패킷(점) 이동선 + 자식 bounce |
| `run.finished` | `.recolor(agentType, state)` + 말풍선 | 상태색 트윈 + `bubble` 말풍선 표시 |
| `approval.opened` | `.summonToBand(agentType)` | 핑크 트윈 + alpha 깜빡 + 대표실 밴드로 직선 이동 |
| `approval.resolved` | `.returnHome(agentType)` | 집 자리로 직선 복귀 + 색 정상화 |
| `state.changed` | `.recolor(agentType, state)` | 색 0.3s 트윈 |
| `command.rejected` | `.reject(agentType)` | 원 흔들림(shake) + 빨강 플래시 |

말풍선 내용은 백엔드 `bubble`(상태별 문구, 심화편 가이드와 1:1) 그대로 쓴다. 앱은 표시만 한다. 이동(직선)은 좌표 간 선형 보간(`SKAction.move`)이며, 경로 탐색(A*)·충돌 회피는 하지 않는다. 위 표에 없는 이벤트(`session.*`, `command.info`)는 오피스 연출과 무관하므로 빈 결과(`[]`)로 매핑한다 — 세션은 로컬 CLI 관제 영역이고, `command.info`는 안내 텍스트일 뿐이다.

## 데이터 흐름

```
SSE 이벤트 (ConsoleEvent)
   → ConsoleStore.apply(event:)  — 상태 갱신 + 최신 이벤트 노출
   → OfficeView 가 최신 이벤트 관측
   → visualIntents(for:event, agents:)  — 순수 매핑
   → OfficeScene.perform([VisualIntent])  — SKAction 실행

클릭 (mouseDown)
   → agentTypeAt(point:)  — 순수 히트테스트
   → OfficeScene 콜백 → OfficeView
   → (일반) 지시 입력 바 → AppRootView.sendCommand(text, agentTypeHint: agentType)
   → (승인 대기) approvalFor(agentType:) → 승인/거절 팝오버 → approve/reject(id)
```

대시보드와 오피스는 여전히 같은 `ConsoleStore` 인스턴스를 공유한다. 지시를 오피스에서 보내면 낙관적 `pendingCommand`가 생기고(기존 로직), 해당 원 위에 진행 배지로 표시된다. run 이벤트가 매칭되면 `.working` 연출로 자연히 이어진다.

## 클릭 상호작용 — 지시 / 승인

- **일반 원 클릭**: 하단에 지시 입력 바를 슬라이드업(`"<이름>에게 지시…"` 플레이스홀더). 전송 시 `sendCommand(text, agentTypeHint: agentType)`. 이는 대시보드 리모컨과 완전히 동일한 경로다.
- **승인 대기(핑크) 원 클릭**: `approvalFor(agentType:)`로 그 에이전트의 승인 건을 찾아 승인/거절 팝오버를 띄운다. 버튼은 기존 `approve(id)`/`reject(id)`.
- 히트테스트(좌표→agentType)와 승인 매칭은 순수 함수라 러너로 검증한다. 팝오버·입력 바의 실제 렌더는 수동 확인.

## 테스트 전략

실행형 테스트 러너(`swift run ConsoleCoreTests`)에 스위트를 추가한다.

- `visualIntents(for:agents:)`: 매핑 대상 이벤트가 각각 기대한 의도로 번역되는지(특히 parentId 유무로 `.working`/`.handoff` 분기), 미지 agentType이면 빈 결과, `session.*`·`command.info` 등 오피스 무관 이벤트는 빈 결과.
- `officeLayout` 확장: 밴드 높이 반영 후에도 좌표 개수 == count, 모든 격자 좌표가 밴드 아래 영역 안.
- `presidentBandSlot`: 순번 N개가 밴드 안에서 서로 다른 좌표.
- `agentTypeAt(point:)`: 원 중심 근처는 그 agentType, 원 밖은 nil.
- `approvalFor(agentType:)`: 매칭 건 반환, 없으면 nil, 여러 건이면 결정론적 선택.

`SKAction` 연출(이동·펄스·깜빡)과 클릭 UI의 실제 렌더는 자동 검증 대상이 아니다. Phase 3와 동일하게 **수동 게이트**(`swift run IdaeriConsole` 눈 확인)로 확인한다.

## 리스크

- **연출 트리거 배선**: 씬 연출이 이벤트에 반응하려면 스냅샷(`agents`)만으로는 부족해 최신 이벤트를 관측 경로로 노출해야 한다. 재연결·재동기화 시 스냅샷 교체가 연출을 중복 트리거하지 않도록, 스냅샷 적용은 색만 정정하고 연출은 이벤트에만 건다.
- **SKAction 렌더**: Phase 3에서 `SpriteView`(또는 `SKView` 폴백) 렌더는 이미 통과했으므로 렌더 자체는 리스크가 아니다. 다만 `mouseDown` 히트테스트가 CLT 실행 앱에서 이벤트를 받는지는 첫 태스크에서 최소 확인한다.
- **좌표계 일관성**: SpriteKit 원점(좌하단)과 히트테스트·이동 목적지 계산의 좌표계를 일치시킨다(Phase 3 `officeLayout` 주석의 규약 계승).

## 범위 밖 (후속 Phase)

- 타일 지도 + GameplayKit A* 경로 탐색·충돌 회피(직선 이동으로 대체).
- 아바타 도트 스프라이트 이미지(원 + 라벨 유지).
- **팀원 확장(가이드의 32명 편성)**: 이대리 에이전트는 실제 일꾼이라, 실 작업이 없는 장식용 팀원 추가는 백엔드 `agent-registry` 철학과 충돌한다. 도입하지 않는다.
- 가이드식 자연어 읽기 질의("왜 늦어져?" → 비서실장이 병목 1개 설명): 부작용 없는 별도 read 경로가 필요하므로 Phase 5+로 둔다.
- 회의실 전용 공간·부서별 방 구조(대표실 밴드 집결로 대체).

---

## 보완 (구현 검증 중 발견 — 2026-07-30)

초기 구현(순수함수 137건 green) 후 실제 백엔드 계약과 대조하는 검증에서, 설계가 암묵적으로 둔 가정 하나가 v1 백엔드와 어긋남을 확인했다. 승인 관련 연출·상호작용이 실데이터에서 동작하지 않으므로 아래를 보완한다.

### 결함: `approval.agentType`이 실데이터에서 항상 null

백엔드 v1은 `ConsoleApproval.agentType`을 항상 `null`로 내보낸다([console-mappers.ts](../../../src/console/application/console-mappers.ts)의 `toConsoleApproval`, [console-read.service.ts](../../../src/console/application/console-read.service.ts)가 명시적으로 "kind→agentType 매핑 도입 시(Phase 2) 채운다"고 미뤄둔 상태). 그 결과:

- `visualIntents`의 `approval.opened`/`approval.resolved`가 `guard let agentType`에서 항상 nil → 빈 배열 → **승인 집결·복귀가 발동하지 않음**(성공 기준 2 무효).
- 승인 대기 원 클릭 시 `approvalFor(agentType:)`가 못 찾음 → **승인 UI가 뜨지 않음**(성공 기준 4 무효).
- 백엔드가 어떤 에이전트도 `AWAITING_APPROVAL`로 파생하지 않음(`deriveAgentState`의 `hasOpenApproval`이 항상 false) → **핑크 전이 없음**.

초기 구현의 순수함수 테스트가 통과한 것은 테스트가 `agentType: "CTO"`로 작성돼 실데이터(null)와 달랐기 때문이다(통과 착시).

### 해결: 백엔드 kind→agentType 매핑 (원래 예고된 "Phase 2")

`PreviewAction.kind`(9종)는 결정론적으로 담당 에이전트에 대응한다. `toConsoleApproval` 한 곳에서 매핑을 적용하면, 이 매퍼를 공유하는 5개 지점(스냅샷 `console-read.service` + 이벤트 발행 4곳 `create`/`cancel`/`expire`/`apply-preview.usecase`)과 `deriveAgentState`의 `AWAITING_APPROVAL` 파생이 동시에 살아난다.

| PreviewKind | agentType |
|---|---|
| `PM_WRITE_BACK` | `PM` |
| `PO_EVAL_CAREERLOG` | `PO_EVAL` |
| `BE_SANDBOX_APPLY` / `BE_SANDBOX_PUSH_PR` | `BE` |
| `CAREER_JD_GAP_BLOG` | `CAREER_MATE` |
| `DOCS_AUDIT_PR` | `DOCS_AUDIT_OPTIMIZER` |
| `PREFERENCE_PROFILE` | `PREFERENCE_LEARNING` |
| `EVENING_BLOG_PUBLISH` / `EVENING_CAREER_REFLECT` | `EVENING_RETRO` |

매핑은 `Record<PreviewKind, AgentType>`로 정의해 새 kind 추가 시 컴파일 에러로 누락을 막는다. 이 변경은 콘솔 read 표현 계층에 국한되며 preview-gate 로직·부작용은 불변이다(read-only 계약 유지). 기존 `agentType: null`을 기대하던 백엔드 테스트는 실제 매핑값 기대로 갱신한다.

### 클라이언트 실버그 (실 SSE 순서에서 드러남)

1. **진행 펄스 즉사**: `run.started`→`.working`(펄스 시작) 직후 백엔드가 `state.changed(IN_PROGRESS)`를 발행하고, 현재 매핑은 이를 `.recolor`로 번역해 `"working"` 액션을 제거한다 → 펄스가 즉시 꺼진다. `state.changed(IN_PROGRESS)`는 `.working`으로 매핑해 펄스를 유지한다.
2. **승인 핑크 전이**: `approval.opened`→`summonToBand`가 색을 바꾸지 않아, 별도 `state.changed(AWAITING_APPROVAL)` 순서에 의존한다. `summonToBand` 연출에서 핑크색을 직접 세팅해 순서와 무관하게 보장한다.
3. **유령 밴드 슬롯**: `sync`가 제거된 에이전트를 `bandOrder`에서 정리하지 않아 reconnect/스냅샷 변동 시 잔여 슬롯이 남는다. `diff.removed`에서 함께 정리한다.
4. **이벤트 replay 부재**: 오피스 탭이 닫혀 있던 동안의 이벤트를 놓친다. `onAppear`에서 현재 store 상태(활성 run·열린 approval)로 초기 연출을 재구성한다.

이 보완의 태스크 분해는 별도 델타 계획서(`docs/superpowers/plans/2026-07-30-idaeri-office-phase4-fixups.md`)에 둔다.
