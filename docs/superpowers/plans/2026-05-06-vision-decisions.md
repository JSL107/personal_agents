# 비전 결정 사항 — `/po-expand` deprecate / Gemini 정식 / 봇 쪼개기 timing (2026-05-06)

> **상위 문서**:
> - [2026-05-05-multi-agent-vision-evaluation.md](../research/2026-05-05-multi-agent-vision-evaluation.md) — 외부 사례 검증
> - [2026-05-05-vision-vs-current-gap-analysis.md](../research/2026-05-05-vision-vs-current-gap-analysis.md) — 갭 분석
>
> **목적**: 갭 분석에서 떠올린 3개 의사결정 + 1개 architecture 질문에 대한 사용자 결정과 본 작성자의 권장을 한 곳에 기록.
> **운영**: dated reference snapshot — 사후 갱신 X. 결정이 바뀌면 새 결정 문서로 분리.

---

## 0. 한 줄 요약

`/po-expand` 정식 deprecate, Gemini provider 는 이미 fallback 으로 활성 (Mock 아님 — 문서만 정정), 봇 쪼개기는 통신 토폴로지 결정 후 (#3a/#3b 가시 가치 작업과 병행) 약 4~5주 시점에 단계 1 진입 권장.

---

## 1. 결정 #1 — `/po-expand` 정식 deprecate

### 1.1 배경
- 갭 분석 §3 의 deprecate 후보로 분류: "신규 아이디어 한 줄 → outline + 명확화 질문" 이 비전 5포지션 (PM/BE/CTO/PO/CEO) 어디에도 명확 매핑 X.
- 사용자 비전에서 미사용 — Stage 2 (PoExpandApplier) 도 이미 commit `c1c477b` 에서 `PREVIEW_KIND.PO_EXPAND` enum deprecated.

### 1.2 결정 (사용자, 2026-05-06)
**전체 deprecate** — 모듈/슬래시/enum/문서 모두 정리.

### 1.3 수행 변경 (이번 commit 의 deprecation 부분)

**삭제 10 파일**:
- `src/agent/po-expand/` 9개 (`po-expand.module.ts`, `application/generate-po-outline.usecase.ts`(+spec), `domain/po-expand.type.ts`, `domain/po-expand.exception.ts`, `domain/po-expand-error-code.enum.ts`, `domain/prompt/po-expand-system.prompt.ts`, `domain/prompt/po-expand.parser.ts`(+spec))
- `src/slack/format/po-outline.formatter.ts` 1개

**수정 10 파일**:
- `src/app.module.ts` — `PoExpandModule` import 제거
- `src/slack/slack.module.ts` — `PoExpandModule` 제거
- `src/slack/slack.service.ts` — `GeneratePoOutlineUsecase` 의존 + DI + 핸들러 dep 제거
- `src/slack/handler/agent-command.handler.ts` — `/po-expand` 핸들러 + import 제거
- `src/slack/handler/retry-run.handler.ts` — `PO_EXPAND` case + import 제거
- `src/model-router/domain/model-router.type.ts` — `AgentType.PO_EXPAND` enum 제거
- `src/model-router/application/model-router.usecase.ts` — `AGENT_TO_PROVIDER` 매핑 제거
- `src/agent-run/domain/agent-run.type.ts` — `TriggerType.SLACK_COMMAND_PO_EXPAND` 제거
- `src/agent-run/application/retry-run.usecase.ts` — `subject` comment 정리
- `src/agent/be-schema/domain/prompt/be-schema.parser.ts` — 주석 1줄 정리

**문서 갱신**:
- `README.md` — slash 표 14→13 (`/po-expand` 1줄 제거)
- `CLAUDE.md` — 에이전트 매핑 표 (`/po-expand` 1줄 제거)

### 1.4 회귀 위험
- 이미 FAILED 상태인 PO_EXPAND AgentRun 의 `/retry-run` 호출 시 `default` 케이스로 폴백 → "지원되지 않습니다" 안내. 안전.
- DB 의 `agent_run.agent_type='PO_EXPAND'` 레코드는 보존 (조회/통계 영향 X — schema 변경 X).
- 외부 사용자 trigger 가 없어 사용자 가시 영향 0.

---

## 2. 결정 #2 — Gemini CLI 정식 활성화 (이미 fallback active — 문서만 정정)

### 2.1 배경
- 갭 분석 §3 의 deprecate/검토 후보. AGENTS.md §6: "현재 `gemini` CLI 미설치, `MockModelProvider`" 라고 명시.

### 2.2 사실 확인 (코드 검증)
- [GeminiCliProvider](../../../src/model-router/infrastructure/gemini-cli.provider.ts) 가 `gemini` CLI 를 직접 spawn (Mock 아님). `--approval-mode plan` read-only.
- [model-router.usecase.ts:35](../../../src/model-router/application/model-router.usecase.ts#L35) `FALLBACK_PROVIDER = ModelProviderName.GEMINI` — primary 호출 실패 시 자동 재시도.
- AGENT_TO_PROVIDER 에 Gemini primary 매핑은 **없음** — backup quota 전용으로 의도된 디자인.
- `redactPii` 적용, throwaway HOME 적용 X (Gemini CLI 가 `~/.gemini` 인증 위치 변경 미지원), `--approval-mode plan` 으로 도구 실행 차단 보안 보강.

### 2.3 결정 (사용자, 2026-05-06)
**문서 정정만**. AGENTS.md §6 의 "Mock" 표현이 stale → 사실대로 "fallback 으로 활성 동작" 으로 수정.

### 2.4 추가 권장 (보류 — 사용자 후속 결정)
- 일부 가벼운 AgentType (예: `WORK_REVIEWER` 의 worklog 회고처럼 짧은 출력) 을 Gemini primary 로 옮길지는 사용 데이터 (`/quota` `pmContext` 비슷한 메트릭) 축적 후 재평가.
- 현재 Gemini fallback 호출 빈도/성공률을 메트릭화하면 의사결정 근거 확보 — 별도 plan 후보.

---

## 3. 결정 #3 — 봇 쪼개기 architecture & timing

### 3.1 사용자 비전 (입력 그대로)
> "이대리는 최종적으로 내 의사소통 창구가 되고 나머지에게 할당하는 식으로 진행될거 같은데"

→ 이대리 = **router** (사용자 ↔ 워커 봇 의사소통 매개), 신규 봇 = **workers** (PM/BE/CTO/PO/CEO 도메인).

### 3.2 외부 사례 매핑 (검증된 사실)
- **CrewAI hierarchical Process** — `manager_agent` 가 라우팅, worker Agent 가 task 수행. 이대리=manager, 도메인 봇=worker 와 직접 매핑 ([docs.crewai.com/concepts/crews](https://docs.crewai.com/concepts/crews)).
- **AutoGen Swarm + HandoffMessage** — manager 가 명시 handoff 로 worker 전환 ([Teams Tutorial](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)). 단 AutoGen 은 maintenance mode — 패턴만 차용.
- **MetaGPT** — Pub/Sub via `Environment` — 이대리가 Environment 역할, 워커 봇이 `_watch([ActionType])` 로 자기 task subscribe.

### 3.3 권장 architecture (검증 사실 기반)

```
┌────────────────────────┐
│ 사용자 (Slack 단일)     │
└────────────┬───────────┘
             │  자연어 / 슬래시
┌────────────▼───────────┐
│ 이대리 = Router         │  ← 현 NestJS app.
│ - Slack ack/respond    │     SlackService + manager logic.
│ - 의도 파악 / 라우팅    │     주: 코드 변경 X (AsIs 유지) + manager-agent 신규 추가.
│ - 응답 집계             │
└──┬───────┬───────┬─────┘
   │       │       │      ↓ Pub/Sub or HandoffMessage
┌──▼──┐ ┌──▼──┐ ┌──▼──┐ ...
│ PM  │ │ BE  │ │ CTO │  ← workers (현 11개 에이전트 + 신규 CTO/CEO)
│ bot │ │ bot │ │ bot │
└─────┘ └─────┘ └─────┘
```

### 3.4 timing — 언제 시작?

**선행 조건** (갭 분석 §6 권장 sequencing 기준):
1. **#1 통신 토폴로지 결정** (Pub/Sub via BullMQ vs hierarchical via manager) — 1주
2. **#2 워크플로우 phase 정의** (사용자→PM→CTO→BE→PO→CEO 시퀀스) — 1주
3. (병행) **#3a PO 통합** + **#3b PM Gmail** — 사용자 가시 가치, 2주

**봇 쪼개기 단계 1 진입 시점**: #1 + #2 결정 후 = **시작 후 약 2주차**.
**봇 쪼개기 완료 시점** (이대리 = 순수 router 패턴 + CTO/CEO 신설): **시작 후 약 4~5주차**.

**왜 #1, #2 가 선행인가?**:
- 통신 토폴로지가 정해지지 않으면 워커 봇이 어떻게 응답을 router 에 돌려줄지 결정 불가.
- workflow phase 가 정해지지 않으면 router 가 사용자 입력을 어느 워커에 보낼지 결정 불가.
- 둘 다 외부 사례 검증된 패턴 (Pub/Sub / Hierarchical / Swarm) 중 1택 — 결정 자체는 1주 plan 으로 가능.

### 3.5 봇 쪼개기 단계 (proposal — 후속 plan 으로 분기)

| 단계 | 내용 | 예상 commit |
|---|---|---|
| 1. Router scaffold | 이대리 안에 `IdaeriRouter` (manager-agent 패턴) 신설. 현 슬래시 핸들러는 그대로 유지하되 `IdaeriRouter.dispatch(intent)` 우회 옵션 추가. | 3~5 |
| 2. 자연어 → intent 분류 | LLM 호출 1회로 사용자 입력을 (PM/BE/CTO/PO/CEO/직접 응답) 중 1개로 분류. 기존 슬래시 인터페이스 보존 (점진적 전환). | 4~6 |
| 3. CTO worker 신설 | 신규 도메인 `src/agent/cto/` — manager_agent 패턴 차용. CTO 가 BE 산출 검토 후 사용자에게 최종 승인 요청. | 6~8 |
| 4. PO 통합 | 갭 분석 §4.4 — Work Reviewer / PO Shadow / Impact Reporter 를 PO 단일 facade 로. PO worker 등장. | 4~6 |
| 5. CEO worker 신설 | 신규 도메인 `src/agent/ceo/` — 메타 감독 + 컨텍스트 오염 점검 (별도 R&D plan 필요). | 6~10 |

**총 견적**: 23~35 commit, 4~5주.

### 3.6 봇 쪼개기 = process 분리? (별도 분리 결정)

"봇을 쪼갠다" 의 두 해석:
- **(A) 단일 NestJS process 안의 sub-agent 분리** — 현재 11 에이전트 패턴 유지, manager 추가 (DDD 모듈 단위 분리).
- **(B) 별도 process / container 분리** — 워커 봇이 별도 NestJS 인스턴스 또는 별도 service.

**권장 (이번 단계)**: **(A) 단일 process** 유지. 이유:
- 1인 사용 — process 분리 운영비 ROI 낮음.
- `omc-teams` 처럼 tmux pane 으로 process-level 분리는 Slack bot 통합과 충돌.
- DDD 모듈 단위 격리만 잘 되면 (B) 로의 마이그레이션은 미래 가능.

(B) 가 필요해지는 시점:
- 워커 봇이 동시에 5+ 실행하며 Node 단일 thread 가 병목.
- 다른 process 권한 격리 필요 (예: BE 가 git push 권한, PM 은 read only).
- 이 시점 도달 시 별도 architecture 결정.

### 3.7 결정 (사용자, 2026-05-06)
**시점**: #1 통신 토폴로지 + #2 워크플로우 phase 결정 후 진입 — 즉 갭 분석 §6 sequencing 의 step 4 (CTO 신설) 자리에 router 패턴 부각.
**범위**: (A) 단일 process 안의 manager + worker 패턴.
**선결**: #1 + #2 결정 plan 을 우선 수립.

---

## 4. 후속 plan 분기

이번 결정 문서로 다음 3개 plan 이 후속 사이클의 입력이 된다:

1. **`{YYYY-MM-DD}-agent-communication-topology.md`** — Pub/Sub via BullMQ vs hierarchical manager_agent vs Swarm handoff 중 1택. 1주.
2. **`{YYYY-MM-DD}-workflow-phase-definition.md`** — 사용자→PM→CTO→BE→PO→CEO 시퀀스 + 각 phase I/O schema. 1주.
3. **`{YYYY-MM-DD}-idaeri-router-pattern.md`** — 위 두 결정 후 봇 쪼개기 단계 1~5. 4~5주.

각 plan 은 별도 commit 으로 분리.

---

## 5. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-06 | 최초 작성. 3개 결정 + 봇 architecture 권장 + 후속 plan 분기. |

— 작성: Claude (Opus 4.7), 2026-05-06
— 갱신 trigger: 결정 변경 또는 후속 plan 진입 시
