# 이대리 macOS 콘솔 — 설계서 (Phase 0+1)

> 이대리(Slack 멀티 에이전트 "AI 회사")를 눈에 보이는 네이티브 화면으로 확장한다.
> 첫 단계는 **뼈대(백엔드 API + 실시간 스트림)** 와 **관제 대시보드(macOS 앱)** 이다.

작성일: 2026-07-27 · 대상 브랜치 base: `main`

---

## 1. 배경과 목적

이대리는 이미 PM·CTO·BE 등 13개 에이전트가 회사를 롤플레이하는 백엔드다. 그러나 그 "회사"가 지금 무슨 일을 하는지는 **Slack 메시지와 cron 로그로만** 드러난다. 밖에서 상태를 읽을 HTTP 표면은 `webhook`·`crawler` 컨트롤러 두 개뿐이고, 에이전트 실행·승인 대기·병목은 시각적으로 파악할 수단이 없다.

이 프로젝트는 그 회사를 **네이티브 화면**으로 끌어낸다. 최종 지향(4단계)은 다음과 같으며, 각 단계는 독립적으로 쓸모 있고 아래로 갈수록 위 단계를 재사용한다.

| Phase | 이름 | 핵심 |
|---|---|---|
| 0 | 뼈대 | 백엔드가 에이전트 상태를 읽기 API + 실시간 스트림으로 노출 |
| 1 | 관제 대시보드 | 상태 5종·승인 대기·병목을 카드/타일로 시각화 (표시 전용) |
| 2 | 지시·승인 리모컨 | 앱에서 자연어 지시 전송 + PreviewGate 승인/반려 (Slack 없이 운영) |
| 3 | 몰입형 오피스 | SpriteKit 타일 맵 + A* 이동, 회의·보고 연출, 대표 지시창 |

**이 문서는 Phase 0+1을 상세 설계한다.** Phase 2·3은 인터페이스가 어긋나지 않도록 방향만 명시한다.

## 2. 관통 제약 (모든 Phase 불변)

1. **AI 구동은 구독형 CLI(codex/claude)로만.** 유료 API SDK 경로를 새로 만들지 않는다. macOS 앱은 **LLM 로직이 0**이며, 모든 "생각"은 기존 NestJS 백엔드가 자식 프로세스로 CLI를 spawn해 수행한다. 앱은 백엔드 API의 얇은 클라이언트일 뿐이다.
2. **로컬 전용.** 백엔드는 사용자 Mac의 localhost에서 계속 돈다. 앱도 같은 Mac에서 `http://127.0.0.1:<port>` 로 붙는다. 원격/터널/인증 강화는 범위 밖(iOS 확장 시 재검토).
3. **읽기·알림만, 부작용 0 (Phase 0+1).** 콘솔 API는 상태를 읽고 이벤트를 흘려보낼 뿐, 에이전트를 새로 발화하거나 외부로 무언가를 보내지 않는다. 발화·승인 등 부작용은 Phase 2에서 기존 게이트(PreviewGate·Router)를 통해서만 추가한다.
4. **기존 규칙 준수.** Prisma만, `ConfigService.get` 만(process.env 직접 X), 새 env는 4곳 동기(`.env.example`+`.env`+`app.config.ts`+README), `pnpm lint:check && test && build` 3중 green.

## 3. Phase 0 — 백엔드 `console` 모듈

### 3.1 위치와 형태
- 새 모듈 `src/console/`. 헥사고날 관례에 맞춰 `interface/`(컨트롤러·SSE) + `application/`(상태 조립·파생) + `domain/`(뷰 타입) 로 나눈다.
- `AppModule`에 등록. 기존 에이전트 모듈은 건드리지 않고, 필요한 서비스(`AgentRunService`, PreviewGate 조회, `AGENT_REGISTRY`)를 **읽기 목적으로 주입**한다.

### 3.2 상태 5종 파생 (핵심 도메인 로직)
백엔드 `AgentRunStatus` 는 3종(`IN_PROGRESS`/`SUCCEEDED`/`FAILED`)뿐이다. 화면이 요구하는 5종은 이를 다른 신호와 합쳐 **순수 함수로 파생**한다.

| 화면 상태 | 색(Notion 팔레트) | 파생 규칙 |
|---|---|---|
| `승인대기` | 진한 핑크 | 해당 에이전트/런에 열린 PreviewGate 승인 건이 있음 (최우선) |
| `진행중` | 노랑 | 열린 `IN_PROGRESS` 런이 있고 승인 대기 아님 |
| `연동대기` | 라벤더 | 외부 연동/자료 부재로 멈춤 (런 실패 사유 or 명시 플래그) |
| `대기` | 흰색 | 앞 단계를 기다림 / 큐에 있으나 미시작 |
| `완료` | 민트 | 최근 런이 `SUCCEEDED` 로 종료, 대기/승인 없음 |

- 우선순위: `승인대기` > `연동대기` > `진행중` > `대기` > `완료`.
- 구현: `deriveAgentState(inputs): ConsoleAgentState` 순수 함수. 입력은 (에이전트별 최근/활성 런 목록, 열린 승인 건 목록). **테스트 1급 시민** — 각 규칙·우선순위를 유닛으로 고정한다.
- `연동대기`의 판별 기준은 v1에서 보수적으로: 런 실패 사유가 연동/자격증명류일 때만. 애매하면 `대기`로 강등(과표시 방지). 정확도는 Phase 2에서 신호를 늘려 개선.

### 3.3 REST 엔드포인트 (모두 읽기)
| 메서드·경로 | 응답 | 용도 |
|---|---|---|
| `GET /v1/console/snapshot` | `{ agents, runs, approvals, serverTime }` | 앱 부팅 시 1콜로 전체 상태 |
| `GET /v1/console/agents` | `ConsoleAgent[]` | 로스터 + 파생 상태 |
| `GET /v1/console/runs?active=true` | `ConsoleRun[]` | 진행/최근 런(계보 `parentId` 포함) |
| `GET /v1/console/approvals` | `ConsoleApproval[]` | PreviewGate 승인 대기 큐 |

`ConsoleAgent` = `{ agentType, displayName, slashCommands, description, state, bubble }`
(`bubble` = 상태별 말풍선 문구, 백엔드가 상태→문구 매핑을 소유해 앱은 표시만).

### 3.4 실시간 스트림 (SSE)
- `GET /v1/console/stream` — `text/event-stream`. 서버→클라 단방향이라 SSE로 충분하고 WebSocket보다 단순하다.
- 이벤트 타입: `run.started`, `run.finished`, `approval.opened`, `approval.resolved`, `state.changed`. 각 이벤트 payload는 위 뷰 타입의 부분.
- 소스: NestJS `EventEmitter2` 로 기존 `AgentRunService` 라이프사이클과 PreviewGate 생성/해소 지점에서 이벤트를 발행하고, `console` 모듈이 구독→SSE로 relay. **기존 코드에는 이벤트 emit 한 줄씩만 추가**(동작 불변).
- 연결 관리: 클라 끊김 시 서버가 스트림 정리, keep-alive 코멘트(`:heartbeat`) 주기 전송.

### 3.5 보안·설정
- 바인딩은 기존 앱과 동일 포트(이대리 `PORT=3002`) 재사용, 별도 리슨 X.
- 선택적 공유 시크릿: `.env` `CONSOLE_API_TOKEN` 이 있으면 `X-Console-Token` 헤더 검사, 없으면 localhost 신뢰(로컬 단독 사용 전제). 새 env는 4곳 동기.

### 3.6 검증
- 유닛: `deriveAgentState` 전 규칙/우선순위, 상태→bubble 매핑.
- e2e(supertest): 각 엔드포인트 200 + 스키마, SSE가 emit된 이벤트를 흘리는지.
- 3중 green.

## 4. Phase 1 — macOS 관제 대시보드

### 4.1 형태·빌드
- SwiftPM 실행형 패키지 `clients/idaeri-console/` (ASCII 경로 유지). SwiftUI + Combine.
- **빌드·검증은 `swift build` / `swift test`** 로 한다. 이 환경은 Command Line Tools만 있고 Xcode(`xcodebuild`)가 없다. macOS SDK에 SwiftUI·SpriteKit·GameplayKit 프레임워크가 포함돼 SwiftPM 링크가 가능하다.
- GUI는 `NSApplication` 을 코드로 기동하는 실행 타깃으로 구성(SwiftPM만으로 창을 띄우는 구조). 실물 렌더 확인은 사용자가 로컬에서 실행.

### 4.2 화면 구성
- **헤더**: 회사명 · 현재 시각 · 전체 진행률(활성 런/완료 비율).
- **부서 그리드**: 에이전트 1명 = 카드. 5종 상태 색 배경 + 말풍선(`bubble`). agent-registry 순서.
- **승인 대기 패널**: 열린 승인 건 목록. Phase 1은 **표시·하이라이트만**(버튼 없음).
- **병목 배너**: 승인대기가 있으면 최상단에 "대표님 결재 대기 N건" 을 강조. "왜 늦어져?"의 정적 선행 버전.

### 4.3 데이터 흐름
- 부팅 시 `GET /snapshot` 1콜로 초기 상태 → 화면 렌더.
- 이후 `GET /stream`(SSE) 구독으로 증분 갱신. 연결 끊기면 지수 백오프 재연결 후 `/snapshot` 재동기화.
- 네트워킹·디코딩·상태 스토어를 뷰와 분리(`ConsoleClient` / `ConsoleStore` / `View`). 각각 독립 테스트 가능하게.

### 4.4 검증
- `swift build` 성공 + `swift test`: JSON 디코딩(계약 픽스처), 상태→색/문구 매핑, 재연결 로직(모의).
- **한계 정직히**: GUI 실물 렌더·창 표시는 CLT 헤드리스 환경에서 자동 검증 불가 → 사용자 수동 실행으로 확인.

## 5. 계약(스키마) 단일 소스

백엔드와 Swift가 어긋나지 않도록 뷰 타입을 이 문서 §3.3 + 부속 스키마로 고정한다. 백엔드 TypeScript 타입이 SoT이고, Swift `Codable` 구조체가 이를 그대로 반영한다. 변경 시 양쪽을 함께 갱신하고, Swift 디코딩 테스트가 계약 픽스처로 드리프트를 잡는다.

## 6. 리스크·미결

- **SwiftPM GUI 기동**: 창 표시까지 SwiftPM만으로 되는지 실증 필요(activation policy 등). 안 되면 최소 Xcode 프로젝트 생성으로 대체 — 단 이 환경엔 Xcode 부재라 사용자 설치 필요. 구현 착수 시 가장 먼저 "빈 창 뜨기"를 스파이크로 검증.
- **`연동대기` 정확도**: v1 보수적 판별(과표시보다 과소표시). Phase 2에서 신호 확장.
- **SSE 이벤트 누락**: 기존 라이프사이클에 emit 지점을 빠짐없이 심었는지 e2e로 확인. 누락 시 화면이 `/snapshot` 재동기화로 자가 치유되도록 재연결 설계.

## 7. Non-goals (Phase 0+1)

지시 전송·승인 버튼(→P2), 움직이는 오피스·A* 경로·회의 연출(→P3), iOS/iPad, 원격 접속·강한 인증, 신규 에이전트 발화.
