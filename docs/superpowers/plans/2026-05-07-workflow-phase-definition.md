# 워크플로우 Phase 정의 plan (2026-05-07)

> **상위 문서**:
> - [2026-05-06-vision-decisions.md](./2026-05-06-vision-decisions.md) — 봇 쪼개기 architecture & timing 결정
> - [2026-05-07-agent-communication-topology.md](./2026-05-07-agent-communication-topology.md) — 통신 토폴로지 (병행 plan)
> - [2026-05-05-vision-vs-current-gap-analysis.md](../research/2026-05-05-vision-vs-current-gap-analysis.md) §4.2
>
> **목적**: 사용자 비전 "사용자 → PM → CTO → BE → PO → CEO → 사용자" 를 phase 정의 + 각 phase 의 입출력 schema + trigger 조건으로 분해. router/worker 구현 plan 의 입력.
> **운영**: 결정 후 dated reference (사후 갱신 X). 신규 phase 결정은 새 plan.

---

## 0. 결론 한 줄 (권장)

**5 phase 일일 루프** (PM → CTO 분배 → BE 실행 → PO 평가 → CEO 메타 평가) + **2 trigger** (사용자 자연어/슬래시 + cron) + **1 fast path** (특정 슬래시는 phase 우회 직접 worker). 각 phase 는 입출력 schema 가 명시된 독립 단위 — router 의 dispatch 단위와 1:1.

---

## 1. 배경 — 현재 phase 부재

### 1.1 현 상태
- 11 슬래시 = 11 단발 호출. 사이클 없음.
- 일부 cron (Morning Briefing / Weekly Summary) 이 PM/Work Reviewer 자동 호출.
- 결과를 다른 worker 로 chain 하는 메커니즘 없음.

### 1.2 비전이 요구하는 흐름
```
사용자 →[Slack 메시지/슬래시]→ 이대리 router
                                      │
                          ┌───────────┴───────────┐
                          ▼                         ▼
                       (slash)                 (자연어)
                       fast path               classify intent
                                                   │
                       ┌───────────────────────────┴───────────────┐
                       ▼                                            ▼
                    PM phase                                  특정 worker 직접
                    (오늘 TODO)
                       │
                       ▼
                    CTO phase  (BE 분배)
                       │
                       ▼
                    BE phase   (실행)
                       │
                       ▼
                    PO phase   (평가)
                       │
                       ▼
                    CEO phase  (메타)
                       │
                       ▼
                    사용자 응답
```

---

## 2. 외부 사례 비교 (검증)

| 프레임워크 | phase 정의 | 출처 |
|---|---|---|
| MetaGPT | UserRequirement → PrepareDocuments+WritePRD → WriteDesign → 코드 → 테스트 (SOP, 코드 중심) | [software_company.py](https://raw.githubusercontent.com/geekan/MetaGPT/main/metagpt/software_company.py) |
| ChatDev (1.0) | Designing → Coding → Testing → Documenting (Waterfall) | [arXiv 2307.07924](https://arxiv.org/abs/2307.07924) |
| CrewAI | Tasks 의 sequential / hierarchical (사용자 정의) | [docs.crewai.com/concepts/crews](https://docs.crewai.com/concepts/crews) |
| AutoGen | RoundRobin / Selector / Magentic / Swarm (사용자 정의) | [Teams Tutorial](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html) |

→ 외부 사례 모두 **소프트웨어 개발 phase 중심**. 이대리의 PM/PO/CEO 비즈니스 phase 와 직접 매핑 X. 사용자 정의 필요.

---

## 3. 권장 Phase 정의

### 3.1 5 phase + 1 fast path

| Phase | 책임 worker | 트리거 | 입력 | 출력 |
|---|---|---|---|---|
| **P1. Plan** | PM | (a) 아침 cron (b) 사용자 `/today` 또는 자연어 (c) handoff from CEO | `{ slackUserId, freeText?, contextRefs? }` | `{ dailyPlan, sources, recentSummaries }` |
| **P2. Assign** | CTO (신설) | P1 완료 + plan 안에 `assignableTasks[]` 존재 | P1 output | `{ assignments: { task, beAssignment, priority }[] }` |
| **P3. Execute** | BE (또는 BE Schema/Test/SRE/Fix) | P2 의 each assignment | `{ task, codeContext, beAssignment }` | `{ artifact, validated, evidence }` |
| **P4. Evaluate** | PO (통합 후) | (a) 저녁 cron (b) `/worklog` (c) handoff from CEO | `{ dayRange, agentRunIds, freeText? }` | `{ quantitativeMetrics, qualitativeReview, careerLog }` |
| **P5. Meta** | CEO (신설) | (a) 주간 cron (b) `/ceo-review` 명시 호출 | `{ weekRange, allPhaseAgentRunIds }` | `{ contextDriftReport, docsQualityReport, finalSummary }` |
| **F. Fast path** | (지정 worker) | 특정 슬래시 (`/review-pr` 등) | 슬래시 인자 | worker 결과 |

### 3.2 Fast path 가 필요한 이유
모든 슬래시를 phase loop 로 강제하면:
- `/review-pr`, `/be-schema`, `/quota` 등 stateless lookup 형 명령이 불필요한 manager dispatch 거침
- Slack 3초 ack 위험 ↑

→ **명시 슬래시 = fast path (router 의 `agentTypeHint` 직접 dispatch)**, **자연어 = phase loop (router 의 intent classifier 통과)** 이중 구조.

---

## 4. 각 Phase 의 입출력 Schema

### 4.1 P1 (Plan) — 기존 PM 재사용

[GenerateDailyPlanUsecase](../../../src/agent/pm/application/generate-daily-plan.usecase.ts) 가 이미 close. 변경:
- output 에 `assignableTasks[]` 명시화 — CTO 가 P2 입력으로 받을 task 후보.
- 현재는 `topPriority / morning / afternoon / blockers` 구조 — `assignableTasks` 는 morning + afternoon 의 부분집합 (자동 개발 자동화 가능 task).

### 4.2 P2 (Assign) — CTO 신설

```ts
interface AssignmentInput {
  dailyPlan: DailyPlan;
  recentBeArtifacts?: { agentRunId: number; artifact: string }[];
}

interface Assignment {
  task: PlanTask;            // P1 의 morning/afternoon 1개 인용
  beAssignment: 'BE' | 'BE_SCHEMA' | 'BE_TEST' | 'BE_SRE' | 'BE_FIX';
  priority: 1 | 2 | 3;
  reasoning: string;
  ctoFinalDecision: boolean; // BE 와 cross-check 후 CTO 가 승인했는지
}

interface AssignmentOutput {
  assignments: Assignment[];
  unassignedTasks: PlanTask[];  // CTO 가 인간 결정 필요로 판단한 task
}
```

CTO worker = LLM call 1회 (Claude 권장 — 코드 도메인). 입력은 plan + recent BE artifacts (RAG 형). 출력 schema-strict.

### 4.3 P3 (Execute) — 기존 BE/BE-* 재사용 + BE 자율화 후속

현 상태: `/plan-task` 는 plan 만 생성. 자율 실행 X.
**Phase loop 1차 도입에서는 자율 실행 X**. P3 = 기존 BE 의 plan 생성만.
**자율 실행은 별도 plan** ([2026-05-05-be-test-self-correction-revival.md](./2026-05-05-be-test-self-correction-revival.md) + sandbox 강화 후).

### 4.4 P4 (Evaluate) — PO 통합 신설

PO 통합 plan ([gap analysis §4.4](../research/2026-05-05-vision-vs-current-gap-analysis.md#44-po-분산--통합)) 결과물:
- Work Reviewer / PO Shadow / Impact Reporter 의 통합 facade.
- 신규 사용자 비전: **이력서용 정리** schema.

```ts
interface EvaluationOutput {
  quantitative: {
    runCount: number;
    avgLatencyMs: number;
    successRate: number;
    artifactSizes: { agentType: string; loc: number }[];
  };
  qualitative: {
    review: string;            // free-text — Work Reviewer 패턴
    blockers: string[];
    wins: string[];
  };
  careerLog: {                  // 신규 — 이력서용
    period: string;             // 'YYYY-MM-DD' or 'YYYY-Wnn'
    achievements: { quantitative: string[]; qualitative: string[] };
    technologies: string[];
    impact: string;
  };
}
```

### 4.5 P5 (Meta) — CEO 신설

```ts
interface MetaInput {
  weekRange: { from: Date; to: Date };
  allPhaseAgentRunIds: number[];
}

interface MetaOutput {
  contextDriftReport: {
    suspectedAgentRunIds: number[];   // 직전 N건 token-level overlap > threshold
    notes: string;
  };
  docsQualityReport: {
    docsScanned: string[];            // docs/ 디렉터리 lint 결과
    issues: { file: string; severity: 'low' | 'medium' | 'high'; note: string }[];
  };
  finalSummary: string;               // 사용자에게 직접 전달
}
```

CEO worker = LLM call 2회 권장 (drift 감지 1회 + docs 점검 1회 — 별도 system prompt).

---

## 5. Trigger 분류

### 5.1 사용자 트리거
- `/today` → P1 fast path (CTO 분배 안 함, 사용자 검토용)
- `/today --auto` (신규) → P1 → P2 → 사용자 ✅ 후 P3
- 자연어 메시지 → router intent classifier → 적절 phase
- `/worklog` → P4 fast path
- `/ceo-review` (신규) → P5

### 5.2 Cron 트리거
| Cron | 시간 | Phase |
|---|---|---|
| Morning Briefing | 매일 09:00 KST | P1 (PM only — auto assign 없음, 사용자 확인 후 P2) |
| Weekly Summary | 매주 금 17:00 KST | P4 + P5 (PO daily aggregate + CEO weekly meta) |
| (미래) Daily Eval | 매일 19:00 KST | P4 only |

---

## 6. 실패 모드 / 회복

| Phase 실패 | 회복 |
|---|---|
| P1 실패 | 사용자에게 에러 안내 — phase loop 중단. /retry-run 으로 재실행. |
| P2 실패 | P1 결과는 사용자에게 "수동 검토 필요" 로 전달. CTO 미실행 명시. |
| P3 실패 | P3 만 재실행. P2 의 다른 assignment 는 정상 진행. |
| P4 실패 | P3 결과는 보존. PO 평가 누락 안내. |
| P5 실패 | 다른 phase 영향 없음 — CEO 보고서만 누락. |

기존 [AgentRunService](../../../src/agent-run/application/agent-run.service.ts) 의 FAILED 상태 + `/retry-run` 호환 — 추가 인프라 X.

---

## 7. 구현 영향

### 7.1 단계별 진입
| 단계 | 내용 | 의존 |
|---|---|---|
| 1 | P1 (PM) output 에 `assignableTasks[]` 추가 — schema 확장 | 없음 |
| 2 | P2 (CTO) worker 신설 | 통신 토폴로지 plan + 단계 1 |
| 3 | P4 (PO) 통합 — 기존 3개 worker facade | 통신 토폴로지 plan |
| 4 | P5 (CEO) worker 신설 + 컨텍스트 오염 알고리즘 | 단계 2 + 단계 3 |
| 5 | Cron schedule 갱신 (Morning/Daily/Weekly) | 단계 1~4 |
| 6 | Slack 자연어 message event 핸들러 + intent classifier | router plan + 단계 1 |

### 7.2 예상 commit 수
- 단계 1 (PM schema 확장): 2
- 단계 2 (CTO worker scaffold + integration): 6~8
- 단계 3 (PO 통합 + careerLog schema): 5~7
- 단계 4 (CEO worker + drift 알고리즘): 8~12
- 단계 5 (cron schedule 변경): 2
- 단계 6 (Slack 자연어 진입): 3~5
- 합계 **~26~36 commit, 5~7주** (router plan 14 commit 별도).

---

## 8. 한계 / 가정

- **자율 BE 실행 (P3)** 은 본 plan 범위 밖. BE-Test self-correction 재도입 plan + sandbox 강화 plan 후 별도 도입.
- **이력서용 schema (P4 careerLog)** 는 사용자가 사용하는 외부 형식 (Notion 템플릿 / 커리어 페이지) 미공유 — 잠정 schema. 사용자 실제 형식 공유 후 정합 조정.
- **CEO 의 컨텍스트 오염 알고리즘** ([gap analysis §6.7](../research/2026-05-05-vision-vs-current-gap-analysis.md#67-컨텍스트-오염-점검--외부-선례-없음--자체-정의-후-plan-화)) 은 외부 선례 없음 — P5 단계 진입 시 별도 R&D plan.
- **Intent classifier 정확도** — 자연어 → phase 매핑이 잘못되면 잘못된 phase 진입. 사용자 confirm 단계 필수.
- **Slack 30초 timeout** — phase loop 가 깊으면 timeout 위험 (router plan 의 `replace_original` 진행 갱신 패턴 차용).

---

## 9. 의사결정 질문

1. 5 phase + fast path 이중 구조 OK? 또는 모두 phase loop 강제?
2. P1 → P2 연쇄가 자동 (사용자 ✅ 클릭 없이) OK? 또는 PreviewGate 거쳐 사용자 confirm?
3. Cron 시간 (09:00 / 17:00 / 19:00 KST) — 사용자 일정 기반 조정?
4. P5 의 CEO 보고가 Slack DM 으로? 또는 Notion DB 기록?
5. 단계 1~6 중 어디부터 진입? 권장: **단계 1 (PM schema 확장)** 부터 — 위험 0, P2/P3 의 입력 표준화.

---

## 10. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-07 | 최초 작성. 5 phase + fast path 권장. 단계별 진입 6 step. |

— 작성: Claude (Opus 4.7), 2026-05-07
— 갱신 trigger: 결정 변경 또는 후속 plan 진입 시
