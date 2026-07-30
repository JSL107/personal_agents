# 이대리 콘솔 Phase 2 — 로컬 세션 inject(작업 주입) 설계

- 날짜: 2026-07-29
- 상위: [Phase 2A 리모컨](./2026-07-27-idaeri-console-phase2a-remote-design.md), [session-catch 계획](../plans/2026-07-27-idaeri-local-session-catch.md)
- 선행조건: session-catch(읽기 전용 세션 관제)는 PR #163으로 main(4dc242d)에 병합 완료
- base 브랜치: main

## 1. 배경과 목적

session-catch로 이대리 macOS 콘솔은 이제 내 로컬 CLI 세션(Claude/Codex)을 읽기 전용으로 관제한다. Phase 2는 그 관제를 **한 방향 쓰기**로 넓힌다 — 콘솔 앱에서 특정 로컬 세션을 골라 **작업을 주입(inject)**한다.

여기서 다루는 대상은 **내 개인 Claude/Codex 터미널 세션**이다. 이대리가 소유한 회사 에이전트(PM/CTO/BE 등)로 지시를 보내는 것은 이미 Phase 2A 리모컨(`IdaeriRouterPort.dispatch`)이 담당하며, 이번 작업과는 경로가 완전히 다르다.

### 제어 모델 — 수동 타겟 전송

이번 범위는 **수동 타겟 전송**이다. 내가 앱에서 세션 카드 하나를 고르고 작업 텍스트를 입력하면 그 세션으로 주입된다. 타겟과 내용을 모두 내가 정한다. "이대리가 idle·cwd·repo를 보고 자동으로 어느 세션에 분배" 하는 지능은 후속 Phase로 미룬다. 다만 큐/키 구조를 (pid, sessionId)로 두어 나중에 자동 분배를 무비용으로 얹을 수 있게 남긴다.

## 2. inject 메커니즘과 정직한 제약

주입은 대상 세션에 설치된 **동기 Stop 훅**으로 이뤄진다. 이 계약은 별도 프로젝트 mds(`~/Desktop/backend/기타/my-desktop`)가 이미 구현·검증했고, 그 순수 로직을 이대리로 이식한다.

동작:

1. 이대리 백엔드가 대상 세션의 pid로 키잉한 파일 큐에 지시 1건을 기록한다.
2. 대상 세션이 한 턴을 끝내면 이대리 Stop 훅이 발화한다. 훅은 stdin 페이로드에서 `session_id`를 읽고, 자신의 부모 프로세스 pid(`process.ppid` = CLI 프로세스 pid)로 큐를 조회한다.
3. 매칭되는 지시가 있으면 stdout에 `{"decision":"block","reason":"<지시>"}`를 출력한다. Claude/Codex는 이를 받아 멈추지 않고 그 지시를 이어서 수행한다.
4. 지시가 없으면 빈 문자열을 출력한다(정상 종료 허용).

핵심 식별 링크: **Stop 훅의 `process.ppid`가 곧 CLI 프로세스 pid이고, 이는 session-catch 리더가 세션 JSON에서 읽는 `record.pid`와 동일하다.** 이미 검증된 일치라 새 매핑 계층이 필요 없다. `ConsoleSession`이 이미 pid·sessionId·source를 들고 있어 inject 키와 그대로 호환된다.

### 정직한 제약(반드시 설계·UX에 반영)

- **전달 시점은 "다음 Stop"이다.** Stop 훅은 세션이 턴을 끝낼 때만 발화한다.
  - **active(작업 중) 세션**: 지금 큐잉하면 현재 턴이 끝나는 즉시 집어간다. → "일하는 세션에 다음 작업을 예약"이라는 핵심 유즈케이스.
  - **idle(입력 대기) 세션**: Stop 훅이 이미 발화·종료된 뒤라, 그 세션을 **다음에 이어 쓸 때**까지 큐에서 대기한다. 즉시 자동 실행되지 않는다.
- **idle 세션 강제 기상은 v1 범위 밖.** TTY 키스트로크 주입(osascript 등)은 터미널 앱 종속·취약해 mds도 하지 않는다. 앱은 idle 세션 카드에 "다음 턴에 전달" 라벨로 정직하게 표기한다.
- **inject는 이대리 DB에 AgentRun을 만들지 않고, 동기 요청/응답이다.** 내 개인 세션이 대상이라 `run.started` SSE가 없다. 세션 조회+enqueue는 동기·빠르고, 백엔드는 "큐잉됨"까지만 알 수 있다(실제 전달은 대상 세션의 다음 Stop에 훅이 파일을 독립 consume하므로 백엔드가 관측할 수 없다). 따라서 Phase 2A의 SSE 기반 비동기 pending 해소(codex 지연 때문)를 흉내 내지 않고, **결과를 HTTP 응답으로 바로 반환**한다. inject 경로에는 신규·기존 SSE 이벤트를 발행하지 않는다.
- **codex의 `decision:block` 수용은 실증 미확인.** mds는 codex에도 동일 Stop 훅을 설치하지만, codex가 실제로 stdout decision을 이어받는지는 이대리에서 직접 확인해야 한다. 훅은 양쪽 다 설치하되, 구현 중 codex 실증에 실패하면 대상을 Claude로 좁힌다(§9 리스크).
- **codex 세션 *발견*은 mds SessionStart 훅에 이미 의존한다.** `~/.mds/codex-sessions/*.json`을 mds 훅이 채운다(session-catch부터의 기존 전제, 이번에 새로 생기는 의존이 아님). 이대리는 inject를 위해 **Stop 훅만** 추가한다.

## 3. 아키텍처 — 컴포넌트

| 레이어 | 파일 | 책임 |
|---|---|---|
| domain(순수) | `src/local-sessions/domain/inject-queue.ts` | `enqueueInject`/`consumeInject` — fs 접근을 deps로 주입. pid로 키잉, 지시 1건=파일 1개(공유 파일 RMW 경쟁 없음). 오염/불일치 항목은 정리, 삭제 실패 시 전달 안 함(재전달 루프 방지) |
| domain(순수) | `src/local-sessions/domain/stop-decision.ts` | `buildStopDecision(payloadRaw, ppid, consume)` — payload→session_id 추출→consume→`{decision:'block',reason}` 또는 `''`. 전 구간 try/catch(우리 버그로 세션을 멈추지 않는다) |
| domain(순수) | `src/local-sessions/domain/inject-hook-install.ts` | `installHooks`/`uninstallHooks` — 마커 기반 idempotent. claude 설정 + codex 훅 경로에 **Stop 훅만** append/remove |
| infra(얇은 entry) | `src/local-sessions/infrastructure/inject-hook.entry.ts` | 독립 실행 스크립트(Nest 부팅 없음). stdin 블로킹 read(TTY면 즉시 포기)→`buildStopDecision`→stdout. 절대 throw 안 함, 항상 exit 0 |
| application | `src/local-sessions/application/session-inject.service.ts` | sessionId→(pid,source) 확인(`LocalSessionService.list()`), 검증, 실 fs deps로 `enqueueInject` 호출. 결과(queued / not-found / empty) 반환 |
| interface | `src/console/interface/console-write.controller.ts`(추가) | `POST /v1/console/sessions/:sessionId/inject`. `ConsoleWriteGuard` 재사용. 결과(queued/not-found/empty)를 HTTP 상태+본문으로 반환. SSE 발행 없음 |
| 배선 | `src/local-sessions/local-sessions.module.ts`, `src/console/console.module.ts` | `SessionInjectService` provider 등록 + 컨트롤러 주입 |
| script | `scripts/console-hooks.ts` + `package.json`(`console:install-hooks`/`console:uninstall-hooks`) | 실 fs·실 경로로 install 도메인 함수 wiring. 로직은 domain에서 테스트, 스크립트는 얇은 wiring |
| Swift | `clients/idaeri-console`(ConsoleStore·ConsoleClient·세션 뷰) | 세션 카드 "작업 주입" 버튼→시트→POST, awaited HTTP 응답으로 성공/실패 표시 |

### 큐 디렉터리와 파일 포맷

- 디렉터리: `~/.idaeri/inject/<pid>/<enqueuedAt>-<seq>.json` (`os.homedir()` 기반 상수. 이대리 자체 소유 — mds의 `~/.mds/inject`를 재활용하지 않아 mds 결합을 재도입하지 않는다).
- 파일 내용: `{ instruction: string, sessionId: string, source: 'claude'|'codex', enqueuedAt: number }`
- 원자성: 지시 1건 = 파일 1개이므로 백엔드 쓰기와 훅 consume이 같은 파일을 놓고 경쟁하지 않는다. 잘못된 입력(pid≤0, 빈 instruction/sessionId)은 조용히 무시.
- consume: 같은 pid 디렉터리에서 `sessionId` 일치 항목 중 가장 오래된 1건을 consume-once. 불일치/오염은 정리(같은 pid를 쓰는 살아있는 세션은 유일하므로 죽은 소유자 항목 삭제는 안전).

## 4. API 계약

```
POST /v1/console/sessions/:sessionId/inject
  Guard: ConsoleWriteGuard (loopback IP + 선택 CONSOLE_REMOTE_TOKEN 상수시간 비교)
  Body: { text: string }
  동작(동기):
    - text 트림 후 비면 → 400 { ok:false, reason:"EMPTY_INSTRUCTION" }
    - LocalSessionService.list()에서 sessionId 조회
      - 없음 → 404 { ok:false, reason:"SESSION_NOT_FOUND" }
      - 정상 → enqueueInject(pid, {instruction:text, sessionId, source})
              → 202 { ok:true, deliver:"next-stop" }
```

- 요청/응답이 동기다. 앱은 awaited HTTP 응답으로 pending을 바로 해소한다(2A처럼 SSE로 되받지 않음). 별도 `commandId`·SSE 매칭 불필요.
- 응답 본문 `deliver:"next-stop"`은 "다음 Stop에 전달" 정직 라벨용 힌트(백엔드는 실제 전달 시점을 관측 못 함).

## 5. Stop 훅 설치/제거

- 방식: **명시적 1회 명령**. `pnpm console:install-hooks` / `pnpm console:uninstall-hooks`. 백엔드 부팅 자동 설치나 앱 토글은 채택하지 않는다(사용자 전역 설정 무단 변경 회피).
- 대상 파일: `~/.claude/settings.json`(Stop, `matcher:''`, `timeout:30`, **동기** — async면 stdout decision이 무시됨) + codex 훅 경로.
- 훅 커맨드: `"<process.execPath>" "<repo>/dist/src/local-sessions/infrastructure/inject-hook.entry.js"`. 설치 시점에 절대경로 계산. 비-ASCII "기타" 경로는 따옴표 인자라 무해(codex `--cd` 헤더 문제와 무관).
- idempotent: 마커 문자열(예: `idaeri-inject-hook`)로 중복 설치를 막고, uninstall은 그 마커 항목만 제거. 기존 Clawd(async, 텔레메트리)·mds Stop 훅과 공존 안전 — 이대리 큐가 비면 `''`(정상 종료 허용)를 반환하므로 다른 훅 동작을 방해하지 않는다.
- 전제: 훅 entry는 `dist/`에 존재해야 한다(이 레포는 `node dist/src/main.js`로 구동하므로 정상 조건에서 존재). dist 부재/stale 시 훅은 아무것도 출력하지 않아 세션은 정상 종료(안전 실패). 레포 이동·dist clean 후에는 install 재실행 필요.

## 6. Swift 앱 변경(`clients/idaeri-console`)

- 세션 섹션의 각 카드에 "작업 주입" 액션 → 텍스트 입력 시트. 전송 시 `POST /v1/console/sessions/:sessionId/inject { text }`.
- 해소: 동기 요청이라 **awaited HTTP 응답으로 종결**한다. 전송 중 optimistic pending 표시 → 202면 성공("큐잉됨 · 다음 턴 전달"), 4xx면 실패(빨강·`reason`). 2A의 SSE 기반 `pendingCommands` 상태기계나 `commandId` 매칭을 이 경로에 끌어오지 않는다(2A dispatch 동작은 불변).
- idle 세션 카드: "주입 시 다음 턴에 전달" 안내 문구. active 세션 카드: 즉시성 기대 가능.
- 테스트: ConsoleClient/ConsoleStore가 CLT라 XCTest 부재 → ConsoleCore 실행형 러너로 inject 요청 인코딩 + 응답→상태 매핑(202 성공 / 404·400 실패+reason) 커버.

## 7. 안전 / 설정

- `ConsoleWriteGuard` 재사용(loopback 127.0.0.1/::1 + 선택 `CONSOLE_REMOTE_TOKEN`). inject는 내 로컬 세션 대상이고 사용자가 명시 발동하므로 **PreviewGate 불필요**.
- **신규 env 0 목표.** `injectDir`는 `os.homedir()/.idaeri/inject` 상수. 테스트를 위해서만 `LOCAL_SESSION_CONFIG` 토큰에 `injectDir` override 필드를 추가(process.env 직접 참조 아님, 주입 토큰 방식 — 레포 규칙 준수).
- CLI 자식 프로세스 격리 규칙(`buildSafeChildEnv`)은 이 경로와 무관(훅은 이대리가 spawn하는 게 아니라 Claude/Codex가 spawn).

## 8. 테스트 전략 (태스크별 TDD 여부)

> 스키마/타입/얇은 배선 태스크에 TDD를 일괄 강제하면 계획과 모순되므로 태스크별로 명시한다.

| 태스크 | TDD | 근거 |
|---|---|---|
| `inject-queue.ts`(enqueue/consume) | **예(테스트 우선)** | 순수·결정론. mds 테스트를 함께 이식. 경쟁·오염·불일치·삭제실패 케이스 |
| `stop-decision.ts` | **예(테스트 우선)** | 순수. payload 파싱·빈 반환·throw 억제 케이스 |
| `inject-hook-install.ts`(install/uninstall) | **예(테스트 우선)** | 순수(fs deps 주입). 마커 idempotency·공존·제거 정확성 |
| `session-inject.service.ts` | **예(테스트 우선)** | LocalSessionService mock + fs mock으로 조회·검증·enqueue 분기 |
| `console-write.controller`(inject 라우트) | 테스트 함께(e2e mock) | 가드·HTTP 상태/본문(202·404·400). 부분 모듈+mock e2e(DB 불필요) |
| `inject-hook.entry.ts` | 테스트 후(수동) | process/stdin/stdout 바인딩은 단위테스트 부적합. 순수 로직은 stop-decision에서 커버. 실증은 §9 |
| `scripts/console-hooks.ts` | 테스트 후(수동) | 게이트 밖 얇은 wiring. 로직은 install 도메인에서 커버 |
| 모듈 배선 | 테스트 없음 | provider 등록만. 전체 `pnpm test`로 회귀 확인 |
| Swift(요청·pending) | 예(러너) | ConsoleCore 실행형 러너로 인코딩·상태전이 |

3중 게이트: `pnpm lint:check && pnpm test && pnpm build` 모두 green. Swift는 `swift build` + `swift run ConsoleCoreTests`. `SessionInjectService` 등 포트 확장 시 기존 mock spec가 깨질 수 있으니 전체 test로 확인.

## 9. 검증 계획(실증 — 사용자 손 필요)

단위·타입·빌드로는 훅 왕복을 증명할 수 없다. 실증 항목:

1. `pnpm console:install-hooks` 후 `~/.claude/settings.json`에 동기 Stop 훅이 마커와 함께 추가됐는지, 재실행이 중복을 만들지 않는지.
2. **Claude 세션 실증**: 실 claude 세션을 작업 중으로 두고 앱에서 inject → 현재 턴 종료 시 주입 지시를 이어받는지. idle 세션은 다음 턴까지 대기하는지.
3. **Codex 세션 실증(리스크 항목)**: codex가 `decision:block`을 실제로 이어받는지. **실패 시 대상을 Claude로 좁히고** codex 경로는 후속으로.
4. `pnpm console:uninstall-hooks`가 이대리 마커 항목만 제거하고 Clawd/mds 훅을 건드리지 않는지.

## 10. 리스크

- **codex decision:block 미수용**: 위 §9-3. 대비 = Claude-only 축소, codex 후속.
- **전역 설정 변경**: 명시적 install 명령 + idempotent + uninstall로 되돌림 가능. 백엔드 자동 설치 안 함.
- **dist 경로 의존**: 훅이 컴파일 산출물을 가리킴. 안전 실패(아무것도 출력 안 함=정상 종료)라 세션을 멈추지 않음. 재빌드/이동 후 install 재실행.
- **비-ASCII 레포 경로**: 훅 커맨드 인자로는 무해. codex exec `--cd` 헤더 이슈와 다름.

## 11. YAGNI 컷(v1 제외)

자동 분배/라우팅(이대리가 세션 자동 선택), 브로드캐스트(다중 세션 동시 주입), idle 세션 강제 기상, 큐잉된 inject 취소 UI, 이대리 회사 에이전트로의 inject(=Phase 2A dispatch 경로), 주입 이력 영속화.

## 12. 성공 기준

- 앱에서 active claude 세션에 작업을 주입하면 그 세션이 현재 턴을 끝낸 뒤 주입 작업을 수행한다.
- idle 세션 주입은 큐에 남고 "다음 턴 전달"로 정직하게 표기된다.
- 세션 조회 실패·빈 입력은 4xx 응답(`reason`)으로 앱에 이유가 보인다.
- 설치/제거 명령이 idempotent하고 기존 훅과 공존한다.
- 3중 게이트 + Swift 러너 green. Slack 경로·기존 콘솔 read/2A 동작 회귀 0.
