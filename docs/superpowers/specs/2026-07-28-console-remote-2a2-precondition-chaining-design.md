# 콘솔 리모컨 2A.2 — 상태 precondition 자동 체이닝 설계

- 작성일: 2026-07-28
- 브랜치: `feat/console-remote-2a2` (base: main @ e16d6fa)
- 선행: 2A.1(PR #161) — 콘솔 리모컨 실패 가시화(`command.rejected`/`command.info`) + PR 자동추론

## 1. 배경과 문제

이대리 콘솔 리모컨에서 일부 worker는 인자가 아니라 "선행 run"이 있어야 동작하는 **상태 precondition worker**다. 콘솔에서 이들을 바로 부르면 선행 run이 없어 각 usecase가 precondition 예외를 던진다. 2A.1 덕에 사유가 `command.rejected`로 앱에 보이긴 하지만, 사용자가 선행 worker를 수동으로 먼저 실행한 뒤 다시 최종 worker를 불러야 하는 번거로움이 남는다.

관측된 선행 의존성(코드 근거):

| worker | 선행 요구 | 인자 필요 | 근거 |
|---|---|---|---|
| CTO (`/assign`) | PM run(18h 이내 + `assignableTaskIds` 있어야) | 없음 | `generate-assignment.usecase.ts:111-131`, `:49-56` |
| PO_SHADOW (`/po-shadow`) | PM run | 없음 | `generate-po-shadow.usecase.ts:35-55` |
| CEO (`/ceo-review`) | PO_EVAL run(필수) | 없음 | `generate-ceo-meta.usecase.ts:99-134` |
| PO_EVAL (`/po-eval`) | WORK_REVIEWER \| PO_SHADOW \| IMPACT_REPORTER 중 1+ | — | `generate-po-evaluation.usecase.ts:54-74` |
| IMPACT_REPORTER (`--recent`) | 없음 | env `IMPACT_REPORT_GITHUB_AUTHOR` | `generate-impact-report.usecase.ts:37,70-75` |
| PM (`/today`) | 없음(외부 context 자동수집) | 없음 | `generate-daily-plan.usecase.ts` |

## 2. 목표

선행 run이 없을 때 선행 worker를 자동으로 먼저 트리거(체이닝)해 최종 worker까지 진행되게 한다. 예: "CEO 리뷰해줘" → PO_EVAL 없으면 PO_EVAL 먼저 → 그 위에 CEO.

**성공 기준**: 콘솔에서 CTO/PO_SHADOW/CEO/PO_EVAL을 선행 run 없이 호출해도, 필요한 선행이 자동으로 채워진 뒤 최종 worker가 성공한다. Slack 경로·라우터·모든 usecase 동작은 불변(회귀 0).

## 3. 확정된 설계 결정

1. **스코프: REMOTE_CONSOLE 국한.** 자동 체이닝은 콘솔 write 경로에서만 발동. 라우터·usecase·Slack 경로 불변.
2. **체인 대상: 전체 재귀.** CEO→PO_EVAL→sub-agent까지 인자 합성 포함.
3. **오케스트레이션: 에러 기반 역방향 재시도(접근법 B).** usecase가 던지는 precondition 예외를 단일 진실의 원천으로 삼아, 예외를 잡으면 선행 worker를 먼저 실행하고 원래 worker를 재시도한다. precondition 예외는 LLM 호출 *전에* 발생하므로 실패한 첫 dispatch의 codex 낭비가 0이다.
4. **인자 합성: IMPACT_REPORTER `--recent` 단일 경로.** PO_EVAL의 sub-agent가 필요할 때 GitHub 최근 PR 기반으로 IMPACT_REPORTER를 자동 생성. WORK_REVIEWER fallback은 두지 않는다(PM 추가 실행·오염 리스크 회피).
5. **재사용: 기존 usecase 신선도 창 신뢰.** 자동 체이닝은 "선행 run이 아예 없을 때만" 발동. 이미 최신 run이 있으면 usecase가 그걸 찾아 dispatch가 그냥 성공한다(중복 codex 0). 콘솔 전용 TTL은 두지 않는다.

## 4. 아키텍처

콘솔 write 경로의 단일 `router.dispatch` 호출(`console-write.service.ts:41-47`)을, 역방향 재시도 루프를 도는 신규 컴포넌트 `PreconditionChainOrchestrator`로 감싼다.

```
POST /v1/console/command (202, fire-and-forget)
  └ ConsoleWriteService.sendCommand         ← owner 주입만 유지
      └ void PreconditionChainOrchestrator.run(
            { source:REMOTE_CONSOLE, slackUserId:owner, text, agentTypeHint, commandId })
          ├ router.dispatch(worker) 시도
          ├ DomainException catch → errorCode 매핑 → 선행 worker run(재귀) → 원래 worker 재시도
          └ 진행/성공/실패를 command.info / command.rejected SSE로 방출(2A.1 재사용)
```

- 오케스트레이터는 `IdaeriRouterPort`와 `ConsoleEventBus`를 주입받는다.
- SSE 방출 책임을 오케스트레이터로 이관해 `ConsoleWriteService.sendCommand`는 owner 주입 + 위임만 남긴다(승인/거절 경로는 불변).

## 5. 예외 → 선행 매핑 테이블

모든 도메인 예외는 `DomainException`(`common/exception/domain.exception.ts`)을 상속하며 `errorCode: string` getter로 코드를 노출한다. errorCode 하나가 "실패한 worker + 없는 선행 + 합성 인자"를 함의한다.

| catch한 errorCode(소속) | 재시도 대상 worker | 선행 액션 | 선행 인자 |
|---|---|---|---|
| `NO_RECENT_PM_RUN` (CTO) | CTO | PM dispatch | 없음 |
| `STALE_PM_RUN` (CTO) | CTO | PM dispatch(fresh) | 없음 |
| `NO_RECENT_PLAN` (PO_SHADOW) | PO_SHADOW | PM dispatch | 없음 |
| `NO_PO_EVAL_RUN` (CEO) | CEO | PO_EVAL dispatch | 없음 |
| `NO_SUB_AGENT_RUNS` (PO_EVAL) | PO_EVAL | IMPACT_REPORTER dispatch | `text="--recent {N}d"` |
| `NO_ASSIGNABLE_TASKS` (CTO) | — | **자동해소 불가** | 즉시 rejected + 안내 |

- 재시도는 `agentTypeHint=재시도 worker`로 명시 dispatch(classify 우회, `idaeri-router.usecase.ts:73-74`).
- 매핑에 없는 errorCode(`EMPTY_WORK_INPUT`, `RECENT_MODE_ENV_MISSING`, `RECENT_MODE_NO_RESULTS`, `UNSUPPORTED_AGENT_TYPE` 등)는 자동해소 대상이 아님 → 원래 예외 메시지로 rejected.
- 매핑은 각 ErrorCode enum을 import해 구성한다. 구현 시 enum value 문자열이 worker 간 충돌하지 않는지 검증한다(충돌 시 예외 클래스 타입까지 함께 키로 사용).

## 6. 재시도 루프 & 가드

```
run(input, chain = { depth: 0, visited: [] }):
  try:
    result = await router.dispatch(input)
    if commandId and result.autoResolvedNotice: emit command.info(autoResolvedNotice)
    return                                        # 성공(선행이 이미 있었거나 재시도 성공)
  catch e:
    if e is not DomainException or e.errorCode not in MAP:
      emit command.rejected(e.message); return
    if e.errorCode == NO_ASSIGNABLE_TASKS:
      emit command.rejected(안내); return          # PM 새로 만들어도 비결정적 → 재시도 무의미
    prereq = MAP[e.errorCode]
    if depth + 1 > MAX_CHAIN_DEPTH(3):
      emit command.rejected("체인 깊이 초과: " + visited); return
    if prereq.worker in visited:
      emit command.rejected("cycle: " + visited); return
    emit command.info("{실패 worker}에 필요한 {prereq.worker} 선행이 없어 먼저 실행합니다")
    await run({ agentTypeHint: prereq.worker, text: prereq.text },
              { depth: depth+1, visited: visited + [실패 worker] })   # 선행 생성(재귀)
    await run(input, chain)                        # 원래 worker 재시도(같은 depth)
```

- **codex 낭비 0**: precondition 예외는 `modelRouter.route` 앞에서 발생(각 usecase 확인). 실패한 첫 dispatch는 LLM을 호출하지 않는다.
- **재사용**: 선행 run이 이미 있으면 usecase가 그걸 찾아 dispatch가 성공 → 체이닝 미발동.
- **최악 경로**: `CEO→PO_EVAL→IMPACT_REPORTER` = codex 3회, depth 2. `CTO/PO_SHADOW→PM` = codex 2회, depth 1. `MAX_CHAIN_DEPTH=3`(기존 `MAX_HANDOFF_DEPTH`와 일관)으로 폭주 차단.
- **동시 명령 안전**: chain state(depth/visited)는 호출 스택 로컬 — 공유 상태 없음.

선행 생성이 실패하면(재귀 run 내부에서 rejected emit) 상위는 원래 worker 재시도를 건너뛰어야 한다. 재귀 run이 성공/실패를 상위에 알리도록 boolean(또는 결과 객체)을 반환해, 선행 실패 시 상위 재시도를 중단하고 체인 경로를 포함한 rejected로 종료한다.

## 7. 인자 합성 (IMPACT_REPORTER `--recent`)

`NO_SUB_AGENT_RUNS`일 때만 발동. `text = "--recent {N}d"`(N은 신규 env `CONSOLE_CHAIN_IMPACT_RECENT_DAYS`, 기본 7) → dispatcher가 subject로 전달(`impact-reporter.dispatcher.ts:22-25`) → usecase `RECENT_MODE_PATTERN`(`generate-impact-report.usecase.ts:37`) 매치 → `executeRecentMode`로 GitHub 최근 PR 종합. WORK_REVIEWER fallback 없음.

## 8. 진행/실패 UX (2A.1 SSE 재사용)

- 각 선행 트리거 직전 `command.info`로 "왜 어느 선행을 당기는지" 가시화.
- 자동해소 불가·깊이 초과·cycle·선행 생성 실패 → `command.rejected`, `reason`에 **체인 경로 포함**(예: `"CEO ← PO_EVAL ← IMPACT_REPORTER: IMPACT_REPORT_GITHUB_AUTHOR 미설정으로 중단"`).
- 최종 성공은 기존 `run.finished` SSE로 이미 반영(오케스트레이터가 별도 성공 이벤트를 만들지 않음).
- `command.info`/`command.rejected` union은 `console.type.ts:61-81`, 방출은 `ConsoleEventBus.publish`.

## 9. 엣지 케이스

- **NO_ASSIGNABLE_TASKS**: PM을 새로 만들어도 그날 plan이 비결정적 → 재시도 안 함, 명시 안내.
- **선행 생성 자체 실패**(IMPACT의 env 없음/PR 0건 → `RECENT_MODE_ENV_MISSING`/`RECENT_MODE_NO_RESULTS`): 자동해소 불가 → 체인 경로와 함께 rejected.
- **commandId 없는 구버전 앱**: SSE emit 생략(기존 하위호환).
- **agentTypeHint 없이 자연어 text만**: 첫 dispatch는 classify 경유. 실패 시 errorCode가 재시도 대상 worker를 함의하므로 `agentTypeHint=재시도 worker`로 명시 재dispatch.

## 10. 파일 변경(예상)

**신규**
- `src/console/application/precondition-chain.orchestrator.ts` — 재시도 루프 본체
- `src/console/domain/precondition-chain.map.ts` — 예외→선행 매핑 테이블
- 각 `*.spec.ts`

**수정**
- `src/console/application/console-write.service.ts` — dispatch→orchestrator 위임
- `src/console/console.module.ts` — provider 등록
- env 4곳 동기(`CONSOLE_CHAIN_IMPACT_RECENT_DAYS`): `.env.example` + `.env` + `src/config/app.config.ts` + README

**불변**: 라우터, 모든 usecase/dispatcher, Slack 경로.

## 11. 테스트 전략

Mock `IdaeriRouterPort`(순차 예외 후 성공 반환) + mock `ConsoleEventBus`로 오케스트레이터 단위 테스트:

- (a) 선행 있음 → 체이닝 없이 단일 dispatch 성공
- (b) CEO 풀체인 3-hop(IMPACT→PO_EVAL→CEO) 성공, `command.info` 순서 검증
- (c) `NO_ASSIGNABLE_TASKS` 즉시 rejected(재시도 안 함)
- (d) 깊이 초과 rejected
- (e) cycle 감지 rejected
- (f) IMPACT env 없음 → 체인 경로 포함 rejected
- (g) commandId 없을 때 emit 생략
- (h) 매핑에 없는 예외 → 원래 메시지 rejected

## 12. 범위 밖 / 후속

- **WORK_REVIEWER fallback 인자 합성**(2A.3 후보): IMPACT `--recent` 실패 시 PM 기반 workText로 대체.
- **Slack 경로 자동 체이닝**: 전역 확장은 라우터 동작 변경이라 별도 설계.
- **2A.1의 CTO·PO_EVAL·CEO 자동 체이닝 외 worker**: 현재 매핑 6종에 한정.
