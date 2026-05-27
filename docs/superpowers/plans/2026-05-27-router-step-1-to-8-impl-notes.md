# Router (Hierarchical Manager Pattern) 구현 결과 정리 노트 (2026-05-27)

> **상위 plan**:
> - [2026-05-07-agent-communication-topology.md](./2026-05-07-agent-communication-topology.md) — 토폴로지 결정 (Hierarchical Manager Pattern)
> - [2026-05-07-workflow-phase-definition.md](./2026-05-07-workflow-phase-definition.md) — Phase 정의 + Router 진입점
> - [2026-05-06-vision-decisions.md](./2026-05-06-vision-decisions.md) — 봇 쪼개기 architecture timing 결정
>
> **구현 commits (origin 대비 17 commit ahead of main)**:
> - step 1 `dc686b5` — domain scaffold (port + types + manager skeleton)
> - step 2 `611e131` — worker dispatcher registry + PM wiring
> - step 3 `1ad3a9a` — 나머지 9 agent dispatcher wiring (10/10 완료)
> - step 4 `1479cd4` — intent classifier 통합 (자연어 → AgentType 1회 LLM)
> - step 5 `082bce4` — Slack app_mention 진입점
> - step 6 `9c127c4` — handoff chain (followUp + cycle/depth 가드)
> - step 7 `152d617` — worker formatter 통합 (DispatchOutcome.formattedText)
> - step 8 `2c236d7` — AgentRun.parentId chain audit
> - fix `f72b45c` — build 회귀 (multi:true type cast + po-shadow extraContext)
> - fix `94d734a` — useExisting + multi 비호환 (잘못된 fix, 동작 안 함)
> - fix `cbef813` — 분산 multi-provider → 중앙 useFactory inject (진정한 root cause)
> - db:push 적용 — `agent_run.parent_id` column 추가
>
> **목적**: 본 turn 의 결과 + 시행착오에서 얻은 lessons learned 를 dated reference 로 정리. 향후 비전 후속 worker (CTO/PO통합/CEO) 진입 시 참고.

---

## 0. 한 줄 결론

토폴로지 plan (2026-05-07) 의 권장안인 Hierarchical Manager Pattern 을 8 step 으로 구현. 자연어 멘션 → intent classifier → worker dispatcher → formatter → handoff chain 까지 전체 회로 가능. 단 **NestJS multi-provider 의 module scope 제약** 을 미리 알지 못해 fix 3회 반복 → testing module bootstrap spec 부재가 root cause.

---

## 1. 완성된 흐름 (사용자 시점)

```
Slack <@BOT> 자연어 메시지
   ↓ app_mention event
RouterMessageHandler.stripMentionPrefix
   ↓
IdaeriRouterUsecase.dispatch
   ├─ agentTypeHint 없음 → IntentClassifierUsecase (LLM 1회, CHATGPT)
   │     └ "UNKNOWN" → INTENT_CLASSIFY_FAILED throw
   └─ dispatcherByType.get(agentType)
        ├─ 미등록 → UNSUPPORTED_AGENT_TYPE throw
        └─ AgentDispatcher.dispatch
              ↓ usecase.execute (LLM + DB)
           DispatchOutcome { agentRunId, output, modelUsed, formattedText, followUp? }
              ├─ followUp 없음 → DispatchResult 반환
              └─ followUp 있음
                    ├─ cycle / depth 검증 → throw 가능
                    ├─ AgentRunService.setParentId (child.id ← parent.id)
                    └─ dispatchInternal 재귀 (max depth 3)
   ↓
RouterMessageHandler.say (thread_ts + formattedText + footer)
```

LLM 호출 비용:
- 자연어 멘션 1회당: classifier 1회 + worker 1회 = **2회 LLM** (chain handoff 미발생 시).
- chain 발생 시: classifier 1 + worker_1 + ... + worker_N (N ≤ 3) = 최대 4회.

---

## 2. 핵심 트레이드오프 / 결정 기록

### 2.1 분산 multi-provider 회피 (commit cbef813)

처음 디자인: 각 agent module 이 `AGENT_DISPATCHER_PORT` 토큰에 `multi: true` 로 등록 → RouterModule 의 `IdaeriRouterUsecase` 가 array 로 받는다.

**실제 동작 안 함**. NestJS 의 multi-injection 은 **single module scope** — module 경계를 넘어 합쳐지지 않는다. 각 agent module 의 multi 가 separate set 라 inject 시 1개씩만 수신.

해법: PreviewGate.forRoot 패턴 차용. RouterModule 이 useFactory + inject 로 10 dispatcher 를 중앙에서 array 합치기:
```ts
{ provide: AGENT_DISPATCHER_PORT,
  useFactory: (...resolved: AgentDispatcher[]) => resolved,
  inject: [PmDispatcher, ..., BeFixDispatcher] }
```

각 agent module 은 dispatcher class 만 providers + exports — multi 토큰 관여 X.

### 2.2 intent classifier — AgentType.PM provider 차용

classifier 가 별도 AgentType enum 추가 없이 `AgentType.PM` (ChatGPT) 로 ModelRouterUsecase.route 호출. AgentRunService 미경유 — AgentRun row 영향 0, 단 cliProvider 의 quota 통계에는 잡힘.

후속 검토: classifier 호출량이 늘면 quota 가 PM agent 와 섞여 보임. 분리 metric 도입 시 별도 plan.

### 2.3 worker formatter 통합 (step 7)

handler 가 worker 별 switch 분기 X — 각 dispatcher 가 자기 worker 의 formatter 호출해 `DispatchOutcome.formattedText` 채움. router-message handler 는 worker 무관하게 `result.formattedText + footer` 만 say.

agent module → slack/format/*.formatter import 가 생긴다 (의존 방향 약간 어색). 단 formatter 는 NestJS Module X / 순수 utility 함수 — 모듈 의존 그래프 영향 0.

### 2.4 chain audit log (step 8)

`AgentRun.parentId` 컬럼 + `@@index([parentId])` (commit 734bfed). manager 가 dispatcher.dispatch 직후 `input.contextRefs.agentRunId` (parent.id) 가 있으면 `setParentId(child.id, parent.id)` 호출. 실패는 try/catch + logger.warn — chain 진행 자체는 멈추지 않음.

DB 적용은 사용자 환경 `pnpm db:push` 책임. 누락 시 finish 의 update 자체가 fail (Prisma client 가 parent_id 알지만 DB 모름) — 본 turn 의 4번째 fix 가 이 케이스.

---

## 3. 미완 / 한계

### 3.1 회귀 spec 부재 — 가장 큰 한계

본 turn 의 DI 회귀 (useExisting + multi → useFactory + multi → 결국 중앙 useFactory) 가 spec 단계에서 잡히지 않았다. 모든 spec 이 unit (mock 만) → NestJS DI 미경유 → multi-provider 의 module scope 동작이 검증 안 됨.

**다음 step 1순위**: RouterModule testing module bootstrap spec.
```ts
Test.createTestingModule({ imports: [RouterModule] })
  .overrideProvider(ConfigService).useValue(...)
  ... // 외부 의존성 mock
  .compile()
```

외부 의존성 override 작업이 큰 만큼 별도 turn 으로 분리.

본 turn 의 fail-safe: IdaeriRouterUsecase constructor 에 `Array.isArray(dispatchers)` guard + `DISPATCHER_REGISTRY_INVALID` error code.

### 3.2 DispatchResult.handoffResults 누락

handoff chain 의 중간 worker 결과가 final DispatchResult 에 propagate 안 됨 — 마지막 worker 의 결과만 노출. 사용자가 chain 전체를 확인하려면 AgentRun 직접 조회 필요.

### 3.3 DM 진입점 부재

현재 router 는 `app_mention` 만 등록. DM (`channel_type: 'im'`) 도 받으려면 별도 분기.

### 3.4 실측 데이터 0

- intent classifier 분류 정확도 (UNKNOWN 비율 등)
- chain 발생 빈도 / 깊이 분포
- worker 별 latency / LLM 비용

운영 데이터 N=20 후 prompt / threshold 미세조정 필요.

---

## 4. 후속 step 권장 순서

| 우선순위 | step | 작업량 | 가치 |
|---|---|---|---|
| 🔴 1 | RouterModule testing module bootstrap spec | 1주 | 회귀 spec 으로 잡기 |
| 🔴 2 | AgentRunPrismaRepository.updateParentId unit spec | 0.5일 | 본 turn 추가 method 의 spec 부재 |
| 🟡 3 | DispatchResult.handoffResults 누적 | 0.5주 | chain 전체 사용자 가시 |
| 🟡 4 | Slack DM 진입 | 0.5주 | router 사용성 확장 |
| 🟢 5 | 실측 데이터 축적 (운영 5~20회) | 외부 | 후속 미세조정 근거 |
| 🔵 6 | CTO worker 신설 (P2 Assign) | 1~2주 | phase plan §4.2 |
| 🔵 7 | PO 통합 facade | 1주 | phase plan §4.4 |
| 🔵 8 | CEO worker 신설 (P5 Meta) | 2~3주 | phase plan §4.5 |

---

## 5. lessons learned

1. **NestJS multi-provider 는 single module scope**. 분산 등록 패턴은 작동 X. PreviewGate.forRoot 가 이미 같은 문제를 forRoot 으로 우회하고 있던 점을 reference 로 사용했어야 했음 (3 fix 사이클 회피 가능).

2. **build/test exit code 의 hook 보고는 신뢰 X**. 본 turn 의 background task notification 이 false positive (exit 0 보고) 인 케이스가 다수. 모든 build 결과는 직접 `echo "exit=$?"` 로 확인.

3. **prisma generate 후 tree-sitter native binding 깨짐**. `pnpm rebuild tree-sitter tree-sitter-typescript` 가 회복 패턴 — 사전 commit 메시지 (734bfed) 에 안내 포함됐으나 사용자 환경 액션 필요.

4. **schema 변경 후 db:push 누락**. 본 turn 에 schema 만 commit 하고 사용자 환경에 db:push 가 안 적용된 채 dev server 가동 시 worker 의 모든 finish 쿼리가 fail. 향후 schema 변경 commit 의 메시지에 `⚠️ pnpm db:push 필수` 헤더 명시 권장.

5. **testing module bootstrap spec 부재가 DI 회귀의 silent path**. 모든 unit spec 이 mock 만 사용해 NestJS DI 미경유 → multi-provider / circular dep / provider missing 류 회귀가 unit 단계에서 잡히지 않음. CI 에 NestJS Test 모듈 compile spec 1개라도 있으면 큰 안전망.

---

## 6. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-27 | 최초 작성. Router step 1~8 + 3 fix + DB 적용 + lessons learned 정리. |

— 작성: Claude (Opus 4.7), 2026-05-27
— 갱신 trigger: 후속 step (#1~#8) 진입 시 또는 lesson 추가 시 새 dated plan 으로 분기
