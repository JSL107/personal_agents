# 이대리 콘솔 Phase 2A — 지시·승인 리모컨 + codex 지연 pending UX (설계)

- 날짜: 2026-07-27
- 상태: 설계 승인 대기
- Base: `main` (461a403)에서 새 브랜치/worktree 분기 — session-catch와 독립
- 선행 완료: Phase 0+1(#158 read API·SSE + macOS 앱), Phase 3(#159 오피스 탭)

---

## 1. 배경 (Why)

콘솔은 지금까지 **완전한 read-only**다. macOS 앱은 백엔드가 노출한 `v1/console` REST(스냅샷/에이전트/런/승인)와 SSE 스트림을 받아 회사 상태를 시각화만 한다. `ConsoleClient`는 GET 두 개(`fetchSnapshot`, `events`)뿐이고, `ConsoleStore`는 상태를 `private(set)`으로 반영만 하며, 뷰의 인터랙션은 탭 전환 Picker 하나가 전부다.

그 결과 사용자는 회사가 "무엇을 하는지" 볼 수 있지만 **콘솔에서 직접 개입할 수 없다.** 에이전트에게 일을 시키려면 Slack으로 가서 멘션/슬래시를 쳐야 하고, PreviewGate 승인 카드도 Slack에서만 누를 수 있다. 관제 화면을 보면서 곧바로 지시하고 승인하는 경로가 없다.

또한 codex(ChatGPT) 호출은 10~40초가 걸린다. Phase 0+1 회고에서 "상태 반영 안 됨"으로 오인됐던 지연이 실제로는 codex latency였다. 리모컨에서 명령을 보내면 이 지연 구간 동안 아무 피드백이 없으면 "먹통"으로 느껴진다. 전송–접수–진행–완료를 눈에 보이게 하는 pending UX가 필요하다.

## 2. 목표 (What) / 성공 기준

콘솔 macOS 앱에서 백엔드로 **명령을 보내는 write 경로**를 열어, 관제 화면에서 직접:

1. **지시** — 에이전트에게 자연어/힌트 기반으로 작업을 시킨다.
2. **승인/거절** — PreviewGate 대기 건을 승인하거나 취소한다.
3. **지연 가시화** — codex 지연 구간을 pending 상태로 표시하고, SSE로 진행/완료를 확정한다.

성공 기준:
- 앱에서 자연어 지시를 보내면 백엔드가 접수(202)하고, 잠시 후 해당 에이전트 카드가 `run.started` → `run.finished` SSE로 진행/완료로 바뀐다.
- 앱에서 승인/거절 버튼을 누르면 PreviewGate가 실행되고, `approval.resolved` SSE로 목록에서 사라진다.
- 명령 전송부터 완료까지 pending 배지가 상태를 단계적으로 보여주고, 지연이 비정상적으로 길면(60초) 경고로 전환된다.
- write 경로는 loopback(+선택적 토큰)으로 보호되고, 기존 read 경로·웹훅은 영향을 받지 않는다.

## 3. 스코프

| 트랙 | 내용 | 이번 spec |
|---|---|---|
| **Phase 2A** | 이대리 13 에이전트 지시 + PreviewGate 승인/거절 리모컨 + codex 지연 pending UX | ✅ |
| **Phase 2B** | 로컬 CLI 세션(Claude/Codex 터미널)에 작업 inject | ⏳ 후속 (선행: `feat/idaeri-local-session-catch` 머지) |

**범위 밖(2A에서 안 함):**
- 로컬 세션 inject — session-catch 코드(`LocalSessionService`, 세션 파일 리더, `ConsoleSession` 뷰 타입)에 의존하며 그 브랜치는 미머지. base가 main 독립이므로 물리적으로 불가.
- AUTO_FLOW 체인(PM→CTO→BE)의 리모컨화 — Slack Bolt 핸들러에 step 전이가 강결합되어 재구성 비용이 큼. 2A는 단발 dispatch만.
- 실행 중 dispatch 실패(intent 분류 UNSUPPORTED 등)의 정밀 가시화 — 우선 앱 타임아웃 폴백으로 처리, 정밀화는 후속(§10 참조).

## 4. 아키텍처

```
[macOS 앱]                                  [백엔드]
 뷰(커맨드바 / 카드 지시 시트 / 승인 버튼)
   │ store.sendCommand / approve / reject
   ▼
 ConsoleStore  ── 낙관적 pendingCommands 추가/전이
   │ client.postCommand / applyApproval / cancelApproval
   ▼
 ConsoleClient (actor, POST + x-console-token)
   │                     POST /v1/console/command
   │                     POST /v1/console/approvals/:id/apply
   │                     POST /v1/console/approvals/:id/cancel
   ▼
 ConsoleWriteGuard (loopback IP 확인 + 선택적 토큰 검증)
   ▼
 ConsoleWriteService (owner env 주입)
   ├─ IdaeriRouterPort.dispatch()   ← 지시 (기존 재사용, fire-and-forget)
   ├─ ApplyPreviewUsecase.execute() ← 승인 (기존 재사용)
   └─ CancelPreviewUsecase.execute()← 거절 (기존 재사용)
        │
        ▼ (기존 발행 경로 그대로)
 ConsoleEventBus ── SSE(run.started/finished, approval.resolved)
   ▲
   └──────────────────────── 앱이 구독 중 → pending 전이 / 목록 갱신
```

**설계 원칙: write는 새 로직을 만들지 않는다.** 지시는 `IdaeriRouterPort.dispatch()`, 승인/거절은 `Apply/CancelPreviewUsecase`에 위임한다. 이 usecase들은 모두 Slack 비종속(입력이 `{ ..., slackUserId }` 또는 `{ previewId, slackUserId }`)이라 REST에서 그대로 재사용된다. 콘솔이 새로 하는 일은 (1) REST 표면, (2) 인증 가드, (3) owner 주입, (4) 결과를 SSE로 되쏘기(이미 기존 이벤트 버스가 함) 뿐이다.

## 5. 백엔드 설계

### 5.1 모듈 구성

기존 [console.module.ts](../../../src/console/console.module.ts)는 "부작용 0" 불변식을 명시하고 있다. write를 섞되 **파일을 분리**해 read/write 경계를 컨트롤러 단위로 유지하고, 모듈은 하나로 중앙 등록한다(NestJS single module scope 규칙).

`ConsoleModule` 변경:
- `imports`에 `RouterModule` 추가 → `IDAERI_ROUTER_PORT` 주입. (`ApplyPreviewUsecase`/`CancelPreviewUsecase`는 `PreviewGateModule.forRoot(global)`가 전역 export하므로 별도 import 불필요.)
- `controllers`에 `ConsoleWriteController` 추가.
- `providers`에 `ConsoleWriteService` 추가.
- 모듈 최상단 주석을 "read + write" 로 갱신(부작용 0 문구 수정).

| 신규 파일 | 역할 |
|---|---|
| `src/console/interface/console-write.controller.ts` | `@Controller('v1/console')`의 `@Post` 3개. `@UseGuards(ConsoleWriteGuard)` |
| `src/console/interface/console-write.guard.ts` | `CanActivate`. (1) remote IP loopback 확인 (2) `CONSOLE_REMOTE_TOKEN` 설정 시 `x-console-token` 헤더 검증 |
| `src/console/application/console-write.service.ts` | owner env 확보 → 3개 usecase 위임. dispatch는 fire-and-forget |
| `src/console/interface/dto/console-command.dto.ts` | `class-validator` 요청 DTO (`text`, `agentTypeHint?`) |

### 5.2 엔드포인트

| Method | Path | Body | 동작 | 응답 |
|---|---|---|---|---|
| POST | `/v1/console/command` | `{ text: string, agentTypeHint?: AgentType }` | `dispatch({ source: 'REMOTE_CONSOLE', slackUserId: owner, text, agentTypeHint })`를 **await 없이** 백그라운드 실행 | `202` `{ accepted: true }` |
| POST | `/v1/console/approvals/:id/apply` | 없음 | `ApplyPreviewUsecase.execute({ previewId: id, slackUserId: owner })` await | `200` 결과 / 예외→ResponseCode |
| POST | `/v1/console/approvals/:id/cancel` | 없음 | `CancelPreviewUsecase.execute({ previewId: id, slackUserId: owner })` await | `200` 결과 / 예외→ResponseCode |

**지시가 fire-and-forget인 이유:** `dispatch`는 내부에서 codex를 호출해 10~40초 걸린다. 이를 HTTP로 await하면 앱이 그동안 블로킹된다. Slack 핸들러의 "즉시 ack → 백그라운드 → SSE" 패턴과 동일하게, 접수만 202로 알리고 진행은 `run.started`/`run.finished` SSE로 전달한다. dispatch의 `DispatchResult.agentRunId`는 앱에 반환하지 않고, 앱은 `agentType + 전송시각`으로 SSE run 이벤트를 매칭한다.

**승인/거절이 await인 이유:** PreviewGate apply/cancel은 상대적으로 짧고, WRONG_OWNER/EXPIRED 같은 즉시 검증 실패를 앱에 바로 알려야 버튼 UX가 자연스럽다. 실제 부작용 적용이 길어지는 경우에도 최종 확정은 `approval.resolved` SSE가 별도로 보장한다.

### 5.3 인증/보안 모델

- **바인딩은 그대로 둔다.** `main.ts`의 `app.listen(port)`를 127.0.0.1로 바꾸면 외부 GitHub 웹훅(`/v1/agent/github`)이 못 들어온다. 대신 **콘솔 write 경로에만** 가드에서 loopback을 확인한다.
- `ConsoleWriteGuard`:
  1. `request.ip`(또는 socket remote address)가 loopback(`127.0.0.1`/`::1`)인지 확인. 아니면 `403`.
  2. `CONSOLE_REMOTE_TOKEN`이 설정되어 있으면 `x-console-token` 헤더와 상수시간 비교. 불일치 시 `401`. 미설정이면 통과하되 부팅 시 1회 경고 로그.
- read 경로(`ConsoleController`/SSE)는 이번 범위에서 변경하지 않는다(민감도 낮음). 필요 시 후속에서 동일 loopback 가드 확장 가능.

### 5.4 승인 owner 모델

- `CONSOLE_OWNER_SLACK_USER_ID` env를 `ConsoleWriteService`가 주입받아 dispatch/apply/cancel의 `slackUserId`로 사용 → **본인 대리 승인**.
- env 미설정 시 write 요청을 명시적 에러(`503`/ResponseCode)로 거부한다. 1인 환경에서 owner는 항상 본인이므로 env 고정이 정확하고, `ApplyPreviewUsecase`의 owner 매칭 계약(WRONG_OWNER)을 **수정하지 않는다**(REMOTE 우회는 다른 경로 안전성까지 흔들어 배제).

### 5.5 기존 코드 변경

- `src/router/domain/idaeri-router.port.ts`: `DispatchSource`에 `'REMOTE_CONSOLE'` 추가.
- **ResponseCode 신규 추가 불필요(구현 확인 후 정정):** 승인/거절 실패는 이미 `PreviewActionException`(WRONG_OWNER/EXPIRED/NOT_FOUND 등)으로 던져지고 `AllExceptionsFilter`가 HTTP로 변환한다(Slack 경로에서 검증됨). 콘솔 write 컨트롤러도 같은 필터를 통과하므로 별도 코드가 필요 없다. owner 미설정만 NestJS `ServiceUnavailableException`(503)으로 처리한다.
- `src/config/app.config.ts`: `CONSOLE_OWNER_SLACK_USER_ID`(optional string, write 시 런타임 필수), `CONSOLE_REMOTE_TOKEN`(optional string) class-validator 추가.
- env 4곳 동기(`.env.example`, `.env`, `app.config.ts`, README 표).

## 6. 앱 설계 (macOS)

### 6.1 ConsoleCore

- **ConsoleClient** (actor) — POST 메서드 3개 추가. base URL·envelope 디코딩 패턴 재사용, `URLRequest`에 `httpMethod = "POST"`, JSON body, `x-console-token` 헤더(env `IDAERI_CONSOLE_TOKEN`, 있을 때만). 시그니처(안):
  - `func postCommand(text: String, agentTypeHint: String?) async throws`
  - `func applyApproval(id: String) async throws`
  - `func cancelApproval(id: String) async throws`
- **Models** — 요청 body용 `Encodable` struct 신규(`CommandRequest { text, agentTypeHint? }`). 기존 모델은 전부 Decodable이므로 write 타입은 별도 정의.
- **ConsoleStore** — 신규 상태와 액션:
  - `@Published private(set) var pendingCommands: [PendingCommand]`
  - `PendingCommand { id(로컬 UUID), text, agentTypeHint?, sentAt, phase }`, `phase ∈ { sent, running, done, failed }`
  - 액션: `sendCommand(text:agentTypeHint:)`, `approve(id:)`, `reject(id:)` — client 호출 + 낙관적 pending 추가/갱신
  - SSE 반영 확장: `apply(event:)`의 `runStarted`/`runFinished`에서 pending 매칭 전이 로직 추가

### 6.2 뷰 (IdaeriConsole)

- **전역 커맨드 바** (DashboardView 상단): 텍스트 입력 + 전송 → `sendCommand(text:, agentTypeHint: nil)`. Router intent 분류로 라우팅.
- **AgentCardView**: "지시" 버튼 → 입력 시트/팝오버(해당 `agentType`를 `agentTypeHint`로 고정) → `sendCommand`. *슬래시 버튼 직접 실행은 안 함 — 대부분 인자 필요(/plan-task, /review-pr)라 입력이 필수.*
- **DashboardView approvalPanel**: 각 승인 건에 승인/거절 버튼 → `approve`/`reject`. 처리 중 비활성.
- **pending 표시**: 카드/커맨드바에 phase별 배지(전송됨 ⏳ / 진행중 🔄 경과초 / 완료 ✅ / 실패 ⚠️).

## 7. codex 지연 pending 상태 기계

```
sendCommand
  └─▶ PendingCommand(phase=.sent)            "전송됨 ⏳"
        │  POST 202 접수 (실패 시 → .failed "전송 실패 ⚠️ 재시도")
        │
        ├─▶ run.started SSE (agentType 매칭) → .running  "진행중 🔄 (경과 Ns)"
        │        │
        │        └─▶ run.finished SSE → .done "완료 ✅" → 짧은 지연 후 pending 제거
        │                                     (run 카드는 기존 SSE 경로로 정상 반영)
        │
        └─▶ 60초 내 run.started 없음 → .failed "codex 지연/실패 의심 — 재시도"
```

**매칭 규칙:**
- `agentTypeHint` 있음(카드 지시): 해당 카드에 즉시 pending 표시. `agentType == hint`이고 `startedAt >= sentAt`인 첫 `run.started`에 바인딩.
- `agentTypeHint` 없음(전역 커맨드바): "라우팅 중" 전역 배너로 시작 → `run.started`의 `agentType`을 받으면 그 카드로 pending 이동.
- 동시 다발 명령은 `sentAt` 오름차순으로 매칭(가장 오래된 미매칭 pending에 우선 바인딩).

**승인 pending:**
```
approve/reject 클릭 → 버튼 비활성(.applying)
  ├─ POST 성공 → approval.resolved SSE가 approvals 목록에서 제거(기존 경로)
  └─ POST 실패(WRONG_OWNER/EXPIRED 등) → 에러 토스트 + 버튼 복구
```

## 8. 에러 처리

| 상황 | 백엔드 | 앱 |
|---|---|---|
| owner env 미설정 | write 503 (`ServiceUnavailableException`) | "콘솔 owner 미설정" 안내 |
| 토큰 불일치 | 401 | "콘솔 토큰 설정 필요" 안내 |
| loopback 아님 | 403 | (정상 경로에선 발생 안 함) |
| 승인 대상 없음/만료/owner불일치 | ResponseCode 매핑 200 envelope | 토스트, 버튼 복구 |
| dispatch 접수는 됐으나 실행 실패 | `run.finished(FAILED)` SSE(가능 시) | 카드 WAITING 반영 |
| dispatch가 run 생성 전 실패(분류 등) | (현재 SSE 없음) | 60초 타임아웃 → pending `.failed` |
| 네트워크 실패 | — | pending `.failed` + 재시도 |

## 9. 테스트 전략

- **백엔드(jest)**:
  - `console-write.service.spec.ts` — owner env 주입/미설정 거부, dispatch 위임(fire-and-forget: await 안 함 확인), apply/cancel 위임, 예외→결과 매핑.
  - `console-write.guard.spec.ts` — loopback 통과 / 비-loopback 403 / 토큰 설정 시 검증 / 미설정 시 통과.
- **앱(실행형 러너, `ConsoleCoreTests`)**:
  - `ConsoleStoreTests`에 pending 전이 스위트 추가: sent→running(run.started)→done(run.finished), 미매칭 타임아웃→failed, 전역(hint 없음)→카드 이동, 다발 명령 sentAt 매칭.
  - `main.swift`에 스위트 호출 한 줄 추가. `swift run ConsoleCoreTests` exit 0 = green.
- **3중 게이트**: `pnpm lint:check && pnpm test && pnpm build` green + `swift run ConsoleCoreTests` green.

## 10. 미해결 / 후속

- **Phase 2B (로컬 세션 inject)**: `feat/idaeri-local-session-catch` 머지 후 별도 spec.
- **dispatch 실행 중 실패의 정밀 가시화**: 현재는 60초 타임아웃 폴백. 정밀화하려면 `command.rejected`/`command.accepted(runId)` SSE 이벤트 신설 검토 — 2A에서는 YAGNI로 보류.
- **AUTO_FLOW 체인 리모컨화**: step 전이가 Slack Bolt 강결합 → 별도 리팩터링 필요.
- **read 경로 loopback 가드 확장**: 필요 시 후속.
- **PreviewGate response_url TTL(30분) vs preview TTL(24h) 불일치**(기존 알려진 이슈, `project_evening_blog_publish`) — 리모컨 승인은 response_url에 의존하지 않으므로 2A와 무관하나, 승인 경로를 손대는 김에 인지만 해둠.

## 11. 변경 파일 요약

**신규(백엔드):**
- `src/console/interface/console-write.controller.ts`
- `src/console/interface/console-write.guard.ts`
- `src/console/interface/dto/console-command.dto.ts`
- `src/console/application/console-write.service.ts`
- 대응 `*.spec.ts`

**수정(백엔드):**
- `src/console/console.module.ts` (RouterModule import, write 컨트롤러/서비스 등록, 주석)
- `src/router/domain/idaeri-router.port.ts` (`REMOTE_CONSOLE`)
- `src/config/app.config.ts` (env 2개)
- `.env.example`, `.env`, `README` (env 동기)

**신규/수정(앱):**
- `clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift` (POST 3)
- `clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift` (pending + 액션)
- `clients/idaeri-console/Sources/ConsoleCore/Models.swift` (CommandRequest, PendingCommand)
- `clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift` (커맨드바 + 승인 버튼)
- `clients/idaeri-console/Sources/IdaeriConsole/AgentCardView.swift` (지시 버튼/시트)
- `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleStoreTests.swift` + `main.swift` (pending 스위트)
