# Agent 통신 토폴로지 결정 plan (2026-05-07)

> **상위 문서**:
> - [2026-05-06-vision-decisions.md](./2026-05-06-vision-decisions.md) — 봇 쪼개기 architecture & timing 결정
> - [2026-05-05-vision-vs-current-gap-analysis.md](../research/2026-05-05-vision-vs-current-gap-analysis.md) §4.1
> - [2026-05-05-multi-agent-vision-evaluation.md](../research/2026-05-05-multi-agent-vision-evaluation.md) — 외부 사례 검증
>
> **목적**: 이대리 router ↔ worker 봇 간 통신 메커니즘을 1택. CTO/CEO 신설 / PO 통합 / 자율 BE 의 **선결 plan**.
> **운영**: 결정 후 본 문서는 dated reference (사후 갱신 X). 실제 구현은 별도 plan 으로 분기.

---

## 0. 결론 한 줄 (권장)

**Hierarchical via Manager Pattern + AgentRun 메시지 로그 통합** — 동기 호출 + 명시 위임 (HandoffSpec) + 기존 AgentRun/EvidenceRecord 가 audit trail. 1인 Slack + CLI subscription quota 제약 하에서 가장 단순/디버그 용이하며, 사용자 비전 "최종 결정은 CTO" 의 책임 흐름과 직접 매핑.

---

## 1. 배경 — 현재 상태

### 1.1 현 통신 인프라
- [agent-run/](../../../src/agent-run/) — `AgentRunService.execute({...})` 가 모든 LLM 호출 lifecycle 캡슐화. EvidenceRecord 가 추적.
- [BullMQ](../../../src/app.module.ts) — Redis 기반. Webhook → impact-report queue 등 비동기 처리에 이미 사용.
- 11개 슬래시 핸들러는 모두 동기 호출 (Slack `ack` → usecase → `respond`).
- 봇 끼리 직접 통신 ❌ — 같은 process 안에서도 router/dispatch 메커니즘 부재.

### 1.2 봇 쪼개기 후 필요 통신
1. **사용자 → router (이대리)** — Slack 자연어/슬래시.
2. **router → worker** — intent 분류 후 위임.
3. **worker → router** — 결과 반환 (성공/실패/추가 질문).
4. **worker → 다른 worker** — CTO 가 BE 호출, PO 가 Work Reviewer 호출 등.
5. **router → 사용자** — 결과 집계 후 응답.

---

## 2. 후보 토폴로지 — 검증된 외부 사례

### 2.1 Hierarchical Manager (CrewAI `manager_agent`)
**출처**: [docs.crewai.com/concepts/crews](https://docs.crewai.com/concepts/crews)
**메커니즘**:
- `manager_agent` 또는 `manager_llm` 이 task 할당 + 완료 감독.
- worker Agent 는 task 실행만, 결과를 manager 에 반환.
- 동기 호출 (Process.hierarchical).

**우리 매핑**:
- 이대리 = manager_agent
- PM/BE/CTO/PO/CEO worker = Agent
- AgentRun = task 실행 단위

**장점**:
- "CTO 최종 결정" 의미 직접 매핑.
- 디버그/추적 단순 (단일 stack frame).
- 신규 인프라 0 — NestJS DI 로 직접 호출.

**단점**:
- 동시 다중 worker 실행이 자연스럽지 않음 (Promise.all 직접 작성 필요).
- worker 가 worker 호출 시 깊이 추적 필요 (cycle 방지).

### 2.2 Pub/Sub via Environment (MetaGPT)
**출처**: [metagpt/environment/base_env.py](https://raw.githubusercontent.com/geekan/MetaGPT/main/metagpt/environment/base_env.py), [Multi-Agent Tutorial](https://docs.deepwisdom.ai/main/en/guide/tutorials/multi_agent_101.html)
**메커니즘**:
- 각 Role 이 `_watch([ActionType])` 로 관심 Action 선언.
- Action 완료 시 `publish_message(env)` → Environment 가 `member_addrs` 매핑으로 배달.
- 비동기 — Role 끼리 직접 참조 X.

**우리 매핑**:
- BullMQ queue per agent type (`pm.queue`, `be.queue`, `cto.queue` 등) 또는 단일 queue + routing key.
- AgentRun = message envelope.

**장점**:
- 비동기 / 다중 worker 동시 실행 자연스러움.
- 봇 끼리 약결합 (loose coupling) — 새 worker 추가 시 publish 만 추가.
- BullMQ 이미 인프라 존재.

**단점**:
- 디버그 어려움 (이벤트 chain 추적).
- 사용자 응답 시간 — Slack 3초 ack 후 결과 수신을 어떻게 동기화할지 추가 디자인 필요 (현재 슬래시 ↔ respond 패턴과 충돌).
- "최종 결정" 의미가 불명확 — manager 명시화 안 됨.
- 인프라 복잡도 ↑ — queue per type, dead-letter, retry policy 등.

### 2.3 HandoffMessage (AutoGen Swarm)
**출처**: [AutoGen Tutorial - Teams](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)
**메커니즘**:
- worker A 가 명시적으로 worker B 에 control 양도 (HandoffMessage).
- 다음 worker 가 conversation 이어받음.

**참고**: AutoGen 자체는 [maintenance mode](https://github.com/microsoft/autogen/discussions/7066) — 라이브러리 의존 X, **패턴만 차용 가능**.

**우리 매핑**:
- 메시지 자체에 `nextHandler: AgentType` 필드 — 명시 위임.
- 동기 호출이지만 chain 식 — manager 가 일일이 dispatch 안 함.

**장점**:
- 명시적 위임 — 사용자 비전의 "BE 의 의견을 듣고 CTO 가 최종 결정" 같은 흐름 직관적.
- 코드 명료 (vs Pub/Sub 의 implicit subscription).

**단점**:
- handoff 사슬이 길어지면 추적 어려움 — manager 의 명시 dispatch 보다 책임 모호.
- 패턴 차용 — 라이브러리 없음 — 직접 구현 부담.

---

## 3. 평가 매트릭스 (이대리 제약 반영)

| 차원 | Hierarchical Manager | Pub/Sub | HandoffMessage |
|---|---|---|---|
| 사용자 비전 매핑 ("CTO 최종 결정") | **★★★** | ★ (manager 없음) | ★★ |
| 1인 사용 / 낮은 동시성 | **★★★** (충분) | ★★ (오버킬) | ★★ |
| Slack 3초 ack 호환 | **★★★** (동기 자연스럽) | ★ (별도 디자인) | ★★ |
| CLI subscription quota (직렬화 적합) | **★★★** | ★ (병렬화 위험) | ★★ |
| 신규 인프라 부담 | **★★★** (0) | ★ (queue per type) | ★★ |
| 디버그 / 추적 용이성 | **★★★** | ★ | ★★ |
| 미래 process 분리 마이그레이션 | ★★ | **★★★** | ★★ |
| 기존 AgentRun 재사용 | **★★★** | ★★ | ★★ |
| 봇 끼리 약결합 | ★ | **★★★** | ★★ |

→ **Hierarchical Manager 5/9 차원 최우수, Pub/Sub 1/9, HandoffMessage 0/9**.

---

## 4. 권장 결정 — Hierarchical Manager Pattern

### 4.1 핵심 인터페이스 (제안)

신규 도메인 [src/router/](../../../src/) 신설 (또는 [src/agent-run/](../../../src/agent-run/) 안에 manager 추가).

```ts
// src/router/domain/idaeri-router.port.ts
export const IDAERI_ROUTER_PORT = Symbol('IDAERI_ROUTER_PORT');

export interface DispatchInput {
  source: 'SLACK_MESSAGE' | 'SLACK_COMMAND' | 'CRON' | 'WEBHOOK';
  slackUserId: string;
  text?: string;
  agentTypeHint?: AgentType;   // 슬래시는 직접 지정, 자연어는 manager 가 분류
  contextRefs?: { agentRunId?: number };
}

export interface DispatchResult {
  agentRunId: number;
  workerType: AgentType;
  output: unknown;
  modelUsed: string;
  followUp?: HandoffSpec;       // worker 가 다른 worker 호출 권한 요청 (manager 가 승인 후 dispatch)
}

export interface HandoffSpec {
  toWorker: AgentType;
  reason: string;
  passthroughInput: Record<string, unknown>;
}

export interface IdaeriRouterPort {
  dispatch(input: DispatchInput): Promise<DispatchResult>;
}
```

### 4.2 Manager 알고리즘 (의사 코드)

```
async dispatch(input):
  workerType = input.agentTypeHint ?? await classifyIntent(input.text)
  result = await this[workerType + 'Usecase'].execute(input)
  if result.followUp:
    log("worker requested handoff", result.followUp)
    nestedResult = await this.dispatch({ ...input, agentTypeHint: result.followUp.toWorker })
    result.handoffResults.push(nestedResult)
  return result
```

### 4.3 cycle / 깊이 보호
- 한 dispatch 사슬 안에서 같은 `workerType` 재진입 시 reject (cycle).
- 최대 handoff 깊이 = 3 (CTO → BE → CTO 정도까지). 초과 시 manager 가 사용자에게 결정 요청.

### 4.4 audit trail
- 모든 dispatch 호출을 `AgentRun` 으로 기록.
- handoff chain 은 `agent_run.parent_id` 또는 `evidenceRecord.payload.handoffChain[]` 으로 추적.
- Prisma schema 변경: `AgentRun.parentId Int?` 신규 필드 + self-relation. (별도 plan)

### 4.5 Slack 응답
- manager 가 chain 끝까지 동기 대기 후 단일 `respond({ replace_original })` 호출.
- 30초 초과 우려 시 진행 단계별 `respond` 갱신 (Slack 의 `replace_original` 패턴).

---

## 5. 비채택 옵션의 잔여 가치

### 5.1 Pub/Sub via BullMQ — 부분 채택 시점
- **Cron 기반 phase loop** (예: 아침 PM, 저녁 PO, 주간 CEO) — 이미 BullMQ 로 schedule. 이 부분은 Pub/Sub 형 fire-and-forget 자연스럽다.
- 즉 사용자 트리거 → Hierarchical / 시간 트리거 → Pub/Sub 이중 구조 OK.

### 5.2 HandoffMessage — 패턴 차용
- Manager 의 `result.followUp: HandoffSpec` 가 본질적으로 HandoffMessage 패턴.
- AutoGen 라이브러리 의존 X — TS interface 로 직접 구현.

---

## 6. 구현 영향 (별도 plan 분기)

### 6.1 신규 파일 (예상)
- `src/router/router.module.ts`
- `src/router/domain/idaeri-router.port.ts`
- `src/router/domain/handoff-spec.type.ts`
- `src/router/domain/router-error-code.enum.ts`
- `src/router/application/idaeri-router.usecase.ts` (manager 본체)
- `src/router/application/idaeri-router.usecase.spec.ts`
- `src/router/application/intent-classifier.usecase.ts` (자연어 → AgentType — 1 LLM call)

### 6.2 수정 파일 (예상)
- `src/slack/slack.service.ts` — 슬래시는 그대로, 자연어 message event 핸들러에서 router.dispatch 호출.
- `src/agent-run/...` — `parentId` 필드 + repository 메서드 추가.
- `prisma/schema.prisma` — AgentRun.parentId Int? + self-relation.

### 6.3 schema 변경 detail
```prisma
model AgentRun {
  ...
  parentId   Int?
  parent     AgentRun?  @relation("AgentRunHandoff", fields: [parentId], references: [id])
  children   AgentRun[] @relation("AgentRunHandoff")
}
```

### 6.4 예상 commit 수
- Router 도메인 scaffold: 3
- Manager + intent classifier: 4
- AgentRun parentId + Prisma: 2
- Slack message event 핸들러: 2
- Spec coverage: 3
- 합계 **~14 commit, 1.5~2주**.

---

## 7. 한계 / 가정

- **Intent classifier 정확도 미실증** — 1 LLM call 로 PM/BE/CTO/PO/CEO 중 1개 분류. 잘못된 분류는 manager 가 user confirm 으로 보정 권장.
- **Slack 30초 timeout** — handoff chain 깊이 ≥3 일 때 위험. `respond({ replace_original })` 패턴으로 진행 갱신 필요.
- **Process 분리 마이그레이션** (gap analysis §3.6 옵션 B) 시점에는 Pub/Sub 가 더 자연 — 이 plan 의 Hierarchical 은 단일 process 전제. 마이그레이션 검토 시점에 재평가.
- **CLI quota 직렬화** — Hierarchical 의 동기 호출이 quota burst 회피에 유리. 동시 호출 제한이 풀리면 Pub/Sub 재검토.

---

## 8. 의사결정 질문 (사용자에게)

1. 권장안 (Hierarchical Manager Pattern) 으로 진입 OK?
2. AgentRun.parentId 추가 — Prisma migration 시점 OK? (현재 synchronize 방식이므로 `pnpm db:push` 1회로 끝)
3. Intent classifier 의 1 LLM call 비용 — 자연어 진입을 슬래시와 병행할지, 슬래시만 유지할지?
4. handoff 최대 깊이 = 3 (제안값) OK?

---

## 9. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-07 | 최초 작성. Hierarchical Manager Pattern 권장. 후속 구현 plan 분기 명시. |

— 작성: Claude (Opus 4.7), 2026-05-07
— 갱신 trigger: 결정 변경 또는 후속 구현 plan 진입 시
