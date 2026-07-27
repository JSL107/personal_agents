# 이대리 macOS 콘솔 Phase 3 (몰입형 오피스) — 설계

## 배경

이대리 macOS 콘솔은 Phase 0+1(PR #158)에서 백엔드 read API·SSE와 카드형 관제 대시보드를 갖췄다. Phase 3의 최종 지향은 "움직이는 오피스"(에이전트가 캐릭터로 돌아다니고 회의·보고를 연출하는 화면)지만, 그 전체는 SpriteKit 타일맵 + GameplayKit A* 이동 + 연출 + 지시창까지 얽혀 한 번에 짓기엔 크고 리스크가 높다.

이 문서는 Phase 3의 **첫 걸음**만 다룬다: 오피스를 **정적으로 배치**하고 에이전트 상태를 **색으로 시각화**하는 스파이크. 캐릭터 이동·연출·지시 상호작용은 범위 밖이다. 이 스파이크의 진짜 목적은 "Command Line Tools 전용 환경에서 SpriteKit이 실제로 창에 렌더링되는가"라는 최대 리스크를, Phase 0의 B1(SwiftUI/AppKit 창 스파이크)과 같은 방식으로 먼저 해소하는 것이다.

## 관통 제약 (불변)

- Swift 앱에 LLM 로직 없음. 지능은 전부 백엔드(구독 CLI). 유료 API 경로 도입 금지.
- 백엔드는 로컬 Mac localhost 유지. 콘솔은 읽기·알림 전용, 외부 부작용 0.
- 빌드·검증은 `swift build` / 실행형 테스트 러너(`swift run ConsoleCoreTests`). 이 환경은 CLT만 있고 Xcode(`xcodebuild`)·XCTest가 없다. macOS SDK에 SpriteKit·GameplayKit 프레임워크가 포함돼 SwiftPM 링크가 가능하다.
- 데이터는 Phase 1의 `ConsoleStore`(스냅샷 + SSE) 그대로 재사용한다. 새 네트워크 경로를 만들지 않는다.

## 목표와 성공 기준

앱에 "오피스" 탭을 추가해, `agent-registry` 전원을 SpriteKit 씬에 격자로 배치하고 각 에이전트를 상태색 원 + 이름 라벨로 표시한다. 성공 기준:

1. `swift run IdaeriConsole` 실행 시 상단에서 "대시보드 / 오피스" 전환이 되고, 오피스 탭에 노드가 실제로 렌더링된다.
2. 백엔드 상태가 바뀌면(런 시작·종료 등) 해당 에이전트 노드의 색이 SSE를 통해 실시간으로 갱신된다.
3. 대시보드와 오피스가 하나의 `ConsoleStore`를 공유한다(데이터 이중화 없음).

## 아키텍처

현재 `DashboardView`가 `ConsoleStore`(@StateObject)와 연결 로직(스냅샷 fetch + SSE 구독 + 지수 백오프)을 **자체 소유**한다. 탭 전환으로 대시보드와 오피스가 같은 데이터를 공유하려면 이 소유권을 상위 뷰로 끌어올려야 한다.

- **`AppRootView`** (신규): `@StateObject ConsoleStore`와 연결 `Task`를 소유한다. 상단 세그먼트("대시보드 / 오피스")로 하위 뷰를 전환하고, 연결 상태 인디케이터도 여기서 표시한다. `main.swift`가 `DashboardView` 대신 이 뷰를 띄운다.
- **`DashboardView`** (변경): `ConsoleStore`를 **주입받도록** 수정한다(자체 `@StateObject`·`connect()` 제거). 화면 구성과 동작은 그대로 유지한다. 연결 상태는 `AppRootView`에서 바인딩으로 받는다.
- **SpriteKit 임베드**: SwiftUI 내장 `SpriteView`로 `OfficeScene`을 호스팅한다(macOS 13 지원, `NSViewRepresentable` 불필요). `SpriteView`가 CLT SwiftPM 실행 앱에서 렌더링되지 않으면 `SKView` + `NSViewRepresentable` 폴백으로 전환한다(스파이크 게이트에서 판정).

연결 로직을 옮기는 것은 이미 머지된 코드(`DashboardView`)에 대한 리팩토링이지만, 탭 공유를 위한 최소 변경으로 한정한다. `DashboardView`의 뷰 본문(헤더·그리드·승인 패널·빈 상태)은 건드리지 않는다.

## 컴포넌트

| 컴포넌트 | 위치 | 역할 | 의존 |
|---|---|---|---|
| `AppRootView` | `Sources/IdaeriConsole/` | store·연결 Task 소유, 탭 전환, 연결 상태 표시 | `ConsoleStore`, `ConsoleClient` |
| `OfficeView` | `Sources/IdaeriConsole/` | `SpriteView`로 `OfficeScene` 호스팅 + store 변화를 씬에 반영 | `ConsoleStore`, `OfficeScene` |
| `OfficeScene` | `Sources/IdaeriConsole/` | `SKScene`. 에이전트 노드(색 원 + 이름 라벨) 생성·색 갱신, 격자 배치 | `officeLayout`, `skColor` |
| `officeLayout(count:in:)` | `Sources/ConsoleCore/` | 에이전트 수 → 격자 좌표 계산. **순수 함수**(테스트 대상) | 없음 |
| `ConsoleAgentState.skColor` | `Sources/IdaeriConsole/Theme.swift` | 상태 → `SKColor` 매핑(기존 SwiftUI `Color`와 별개) | `ConsoleAgentState` |

`officeLayout`을 `ConsoleCore`에 두는 이유: 순수 계산이라 실행형 테스트 러너(`ConsoleCore` 의존)에서 검증할 수 있기 때문이다. SpriteKit에 의존하는 `OfficeScene`·`skColor`·`OfficeView`는 실행 타깃(`IdaeriConsole`)에 둔다(코어를 SpriteKit에 묶지 않는다).

## 데이터 흐름

```
스냅샷 / SSE 이벤트
   → ConsoleStore.agents (@Published)
   → OfficeView 가 onChange 로 관측
   → OfficeScene.sync(agents:) 호출
   → 노드 추가/제거 + fillColor 갱신
```

대시보드와 오피스는 같은 `ConsoleStore` 인스턴스를 관측하므로, 한 번 받은 상태가 두 화면에 동시에 반영된다. `OfficeScene.sync`는 현재 노드 집합과 들어온 `agents`를 비교해 신규는 추가, 사라진 것은 제거, 남은 것은 색만 갱신한다. 이 diff 계산(추가/제거할 agentType 집합)은 순수 함수로 분리해 테스트한다.

## 상태 → 색 매핑

Phase 1 `Theme.swift`의 `ConsoleAgentState.accentColor`는 SwiftUI `Color`다. SpriteKit은 `SKColor`(= `NSColor`)를 쓰므로, 같은 팔레트를 `SKColor`로 반환하는 `skColor` 속성을 추가한다. 색 값(민트/노랑/진핑크/라벤더/흰색)은 Phase 1과 동일하게 유지한다.

## 테스트 전략

실행형 테스트 러너(`swift run ConsoleCoreTests`)에 스위트를 추가한다.

- `officeLayout`: N개 입력 → 반환 좌표 개수 == N, 모든 좌표가 주어진 씬 크기 경계 안, 서로 겹치지 않는 격자 간격.
- 노드 diff 계산: 이전 agentType 집합 + 새 집합 → 추가/제거 집합이 정확한지(신규 추가, 사라진 것 제거, 공통은 유지).
- `skColor`: 상태 5종 모두 매핑이 존재.

SpriteKit 씬의 실제 렌더링(원·라벨이 창에 보이는지)은 자동 검증 대상이 아니다. Phase 0 B1과 동일하게 **수동 스파이크 게이트**로 확인한다.

## 리스크와 스파이크 게이트

**최대 리스크**: CLT 전용 환경에서 `SpriteView`(또는 SKView)가 실제로 창에 렌더링되는지 미검증이다. SwiftUI/AppKit은 B1에서 확인됐지만 SpriteKit 렌더 경로는 처음이다.

**게이트**: 구현 첫 태스크에서, 빈 `OfficeScene`에 원 하나만 띄우는 최소 스파이크를 만들어 `swift run IdaeriConsole` → 오피스 탭에 원이 보이는지 확인한다. 보이면 나머지를 쌓고, **안 보이면 거기서 멈추고** `SKView` + `NSViewRepresentable` 폴백을 시도한다. 그것도 실패하면 Xcode 필요 여부를 사용자에게 에스컬레이션한다(정직히: 이 경로는 사전 실증 불가, 실행 시점에 판정).

## 범위 밖 (후속 Phase)

- 캐릭터 이동, GameplayKit A* 경로 탐색
- 회의·보고 연출(체인 실행 시 캐릭터 군집)
- 대표 지시창·승인 버튼 등 쓰기 상호작용 (Phase 2)
- 부서별 그룹 배치(현재는 단순 격자), 좌석/방 구조가 있는 타일맵
- 도트 스프라이트 등 이미지 에셋(현재는 도형 + 라벨)
- 오피스 씬 내 말풍선(bubble 표시)
