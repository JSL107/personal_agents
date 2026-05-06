# 비전 vs 현재 구현 — 갭 분석 (2026-05-05)

> **상위 문서**: [2026-05-05-multi-agent-vision-evaluation.md](./2026-05-05-multi-agent-vision-evaluation.md) — 외부 사례 검증
> **목적**: 사용자가 정의한 5포지션 (PM/BE/CTO/PO/CEO) 비전을 현재 [src/](../../../src/) 11개 에이전트 + 인프라와 1:1 비교해 **남은 것 / 제거할 것 / 바꿀 것** 을 추측 없이 정리.
> **운영**: 외부 사례 검증 문서와 함께 분기 1회 갱신.

---

## 0. 결론 한 줄

**비전 5포지션 중 PM·BE·PO 는 부분 구현, CTO·CEO 는 0%.** PO 는 3개 에이전트(Work Reviewer / PO Shadow / Impact Reporter)로 분산돼 통합·정리 필요. 통신 메커니즘과 워크플로우 phase 가 미정의 — 이게 CTO/CEO 신설의 선행 조건.

---

## 1. 현 11개 에이전트 → 비전 5포지션 매핑

매핑 신뢰도: ✅ 직접 매핑 / 🟡 부분 매핑 / ❌ 없음

| 현 에이전트 | 슬래시 | 진입 usecase | 비전 포지션 | 매핑 |
|---|---|---|---|---|
| PM | `/today` | [generate-daily-plan.usecase.ts](../../../src/agent/pm/application/generate-daily-plan.usecase.ts) | **PM** | ✅ |
| Work Reviewer | `/worklog` | [generate-worklog.usecase.ts](../../../src/agent/work-reviewer/application/generate-worklog.usecase.ts) | **PO** (정량/정성 평가 일부) | 🟡 |
| Code Reviewer | `/review-pr` | [review-pull-request.usecase.ts](../../../src/agent/code-reviewer/application/review-pull-request.usecase.ts) | **CTO** (코드 리뷰 일부) | 🟡 |
| BE | `/plan-task` | [generate-backend-plan.usecase.ts](../../../src/agent/be/application/generate-backend-plan.usecase.ts) | **BE** (계획만) | 🟡 |
| PO Shadow | `/po-shadow` | [generate-po-shadow.usecase.ts](../../../src/agent/po-shadow/application/generate-po-shadow.usecase.ts) | **PO** (계획 재검토) | 🟡 |
| PO Expand | `/po-expand` | [generate-po-outline.usecase.ts](../../../src/agent/po-expand/application/generate-po-outline.usecase.ts) | (어디에도 정확 매핑 X — 아이디어 → outline) | ❌ |
| Impact Reporter | `/impact-report` | [generate-impact-report.usecase.ts](../../../src/agent/impact-reporter/application/generate-impact-report.usecase.ts) | **PO** (임팩트 보고) | 🟡 |
| BE Schema | `/be-schema` | [generate-schema-proposal.usecase.ts](../../../src/agent/be-schema/application/generate-schema-proposal.usecase.ts) | **BE 전문** | ✅ |
| BE Test | `/be-test` | [generate-test.usecase.ts](../../../src/agent/be-test/application/generate-test.usecase.ts) | **BE 전문** | ✅ |
| BE SRE | `/be-sre` | [analyze-stack-trace.usecase.ts](../../../src/agent/be-sre/application/analyze-stack-trace.usecase.ts) | **BE 전문** | ✅ |
| BE Fix | `/be-fix` | [analyze-pr-convention.usecase.ts](../../../src/agent/be-fix/application/analyze-pr-convention.usecase.ts) | **BE 전문 / CTO** (컨벤션 점검) | 🟡 |
| **CTO** (총괄) | — | — | **CTO** (BE↔PM 중재 + 업무 할당 + 최종 결정) | ❌ |
| **CEO** (총괄) | — | — | **CEO** (메타 감독 + 컨텍스트 오염 점검 + 문서 퀄리티) | ❌ |

### 1.1 비전 포지션 → 현 구현 커버리지

| 비전 | 현 커버리지 | 한 줄 평가 |
|---|---|---|
| PM | 🟡 60% | TODO 통합 부분: Slack(mentions/inbox) + GitHub + Notion 검증. Gmail/Figma/Naver `not implemented`. 중복 제거 부분 — Linear 트리아지 수준 미달. |
| BE | 🟡 50% | 계획 / Schema / Test / SRE / Fix 5종 슬래시 보유. 자율 개발 ❌. 봇 간 의사소통 ❌. |
| CTO | 🟡 15% | Code Reviewer + BE Fix 의 컨벤션 점검만. 업무 할당 ❌. 최종 결정 메커니즘 ❌. PM↔BE 중재 ❌. |
| PO | 🟡 40% | Work Reviewer + Impact Reporter + PO Shadow 3개 분산. **이력서용 정리 ❌**. 통합 PO 단일 진입 ❌. |
| CEO | ❌ 0% | 컨텍스트 오염 점검 ❌. 문서 퀄리티 점검 ❌. 보고서 메타 평가 ❌. |

---

## 2. 남은 것 (구현 / 보강 필요)

### 2.1 PM — 멀티소스 통합 확장

**현황** (검증):
- Slack mentions ([slack-collector](../../../src/slack-collector/)) ✅
- Slack inbox ([slack-inbox](../../../src/slack-inbox/)) ✅
- GitHub ([github](../../../src/github/)) ✅ (assigned issues/PRs)
- Notion ([notion](../../../src/notion/)) ✅ (Daily Plan write-back 포함)

**남은 것**:
- ❌ Gmail 통합 — 외부 사례 (Lindy AI) 가 검증한 통합. PM 비전의 일부.
- ❌ Figma 통합 — 외부 사례 모두 `not verified`. **우선순위 낮춤** ([상위 문서 §5.3](./2026-05-05-multi-agent-vision-evaluation.md#53-비현실적--재고-권장)).
- ❌ Naver 통합 — 외부 검증 사례 없음. **우선순위 낮춤**.
- ❌ 중복 제거 알고리즘 — 현재 단순 컬렉션. Linear Triage Intelligence 패턴 차용 검토.
- ❌ 개인적 용무 입력 → Notion 자동 작성 — 사용자 비전 명시. 현재 `/today` 가 사용자 입력을 받지만 "개인적 용무" 별도 라벨링 X.

### 2.2 BE — 자율성 + 봇 간 의사소통

**현황**:
- BE 5종 슬래시는 **단일 호출 + 응답** 구조. 자율 루프 X.
- 봇 간 의사소통은 EvidenceRecord 로 흔적만 남음 — 직접 message exchange X.

**남은 것**:
- ❌ 자율 실행 루프 — 비전 "자율 개발". 현재 `/plan-task` 는 plan 만 생성. 실제 코드 작성/검증 자동화 X.
- ❌ BE ↔ CTO 의사소통 채널 — 통신 메커니즘 결정 후 ([§4.1](#41-에이전트-간-통신-메커니즘))
- ⚠️ CODE_RULE 준수 강제 — 현재 LLM prompt 에 CODE_RULES.md 일부 주입. 사용자가 "이상론적 CODE_RULE 공유 예정" — 도입 시 prompt 갱신 필요.

### 2.3 CTO — 신규 포지션 전체

**남은 것 (전부)**:
- ❌ `/cto-assign` (또는 유사) — 사용자 / PM 의 TODO 를 BE 에 분배.
- ❌ BE ↔ CTO cross-check 메커니즘 — CrewAI hierarchical Process 의 `manager_agent` 패턴 차용 검토 ([상위 문서 §6.3](./2026-05-05-multi-agent-vision-evaluation.md#63-워크플로우-시퀀스--crewai-hierarchical-process-매핑-출처-crewai)).
- ❌ 최종 결정 권한 의미 — schema/Slack 액션의 어디에 표현되는지.
- ❌ Code Reviewer + BE Fix 를 CTO 산하로 통합?

### 2.4 PO — 통합 + 이력서 산출

**현황**: 3개 에이전트 분산 (Work Reviewer / PO Shadow / Impact Reporter).

**남은 것**:
- ❌ 이력서용 정리 산출 — 외부 사례 미확인 ([상위 문서 §5.1](./2026-05-05-multi-agent-vision-evaluation.md#51-강점-외부-사례-대비-차별성-사실-기반)). 자체 schema 정의 필요. 후보 schema:
  ```
  { period, achievements: { quantitative[], qualitative[] }, technologies[], impact }
  ```
- ❌ 통합 단일 진입 — `/po` 또는 사용자 트리거 없이 일일 cron.
- ❌ 정량/정성 평가의 evidence 통합 — AgentRun + EvidenceRecord 로 추적 가능, 집계 logic 없음.

### 2.5 CEO — 신규 포지션 전체

**남은 것 (전부)** — 외부 사례 미확인이라 자체 정의 우선:
- ❌ PO 보고서 최종 평가 — 메타 평가 알고리즘.
- ❌ BE ↔ CTO 컨텍스트 오염 점검 — **알고리즘 미정** ([상위 문서 §6.7](./2026-05-05-multi-agent-vision-evaluation.md#67-컨텍스트-오염-점검--외부-선례-없음--자체-정의-후-plan-화)). 후보:
  - 같은 Slack user 의 직전 N건 AgentRun output 의 token-level overlap 측정
  - inputSnapshot 의 prompt-key 충돌 검사
- ❌ 문서 퀄리티 점검 — `docs/` 디렉터리 lint 자동화 (markdownlint 등).
- ❌ 주기 cron — 일/주 단위 점검 후 Slack 보고.

---

## 3. 제거 / Deprecate 후보

| 항목 | 상태 | 근거 |
|---|---|---|
| PoExpandApplier (Stage 2) | **이미 deprecated** | commit `c1c477b refactor(preview-gate): PREVIEW_KIND.PO_EXPAND deprecate (V3 #11)` |
| `/po-expand` 슬래시 + 모듈 전체 | **deprecated (2026-05-06)** | 사용자 결정. po-expand 9개 파일 + po-outline.formatter 삭제, AgentType/TriggerType enum 정리, README/AGENTS/CLAUDE.md 표 갱신. |
| PO Shadow / Impact Reporter / Work Reviewer 분산 | **재구성 후보** | PO 단일 통합 시 흡수. 즉시 제거 X — 통합 plan 후 단계적 |
| Gemini provider | **정식 활성 (이미 fallback 으로 동작)** | [GeminiCliProvider](../../../src/model-router/infrastructure/gemini-cli.provider.ts) 가 `gemini` CLI 를 spawn (Mock 아님). primary 호출 실패 시 자동 재시도. AGENTS.md 의 "Mock" 표현은 stale — 2026-05-06 정정. |
| Crawler 도메인 ([crawler/](../../../src/crawler/)) | 보존 | AGENTS.md "이대리에 위임 가능성으로 보존" — 비전과 무관해도 미래 가치. 단 비전 포지션과 직접 연결 X. |
| `MCP+RBAC` 도입 | **이미 보류 결정** | [2026-04-30-mcp-rbac-decision.md](../plans/2026-04-30-mcp-rbac-decision.md) — 외부 부작용 surface 표면화 시 재평가 |

---

## 4. 변경 / 재구성

### 4.1 에이전트 간 통신 메커니즘

**현재**: [agent-run/](../../../src/agent-run/) 의 EvidenceRecord 가 사후 흔적만 — 봇 끼리 직접 message exchange 메커니즘 ❌.

**선택지** (외부 검증):
| 옵션 | 출처 | 장점 | 단점 |
|---|---|---|---|
| Pub/Sub via BullMQ | MetaGPT (Pub/Sub via Environment) | BullMQ 이미 인프라 존재. 분리/확장 용이. | watch/dispatch 코드 신규 |
| Hierarchical via Manager Agent | CrewAI hierarchical Process | "최종 결정은 CTO" 와 직접 매핑 | 느슨한 협업 (BE 자율) 표현 어려움 |
| HandoffMessage (Swarm) | AutoGen Swarm | 명시적 handoff — 가독성 높음 | AutoGen maintenance mode 라 라이브러리 X — 패턴만 차용 |

**권장 결정 plan**: 별도 plan 문서 (`2026-MM-DD-agent-communication-topology.md`) 로 분기.

### 4.2 워크플로우 phase 정의

**현재**: phase 미정의. 슬래시별 단발 호출.

**비전 흐름** (사용자 입력 그대로):
```
사용자 → PM (TODO 합본) → CTO (분배) → BE (실행) → PO (평가) → CEO (메타 평가) → 사용자
```

**외부 패턴**:
- MetaGPT SOP (PRD → Design → Code → Test) — code 중심, 비전과 부분 매칭
- ChatDev Waterfall (Designing → Coding → Testing → Documenting) — 코드 중심
- CrewAI Tasks 의 sequential / hierarchical — 직접 매핑 가능

**결정 필요**: 매일 실행되는 phase loop 인지, 사용자 트리거인지, 혼합인지.

### 4.3 CTO 의 "최종 결정" 메커니즘

**비전**: "BE 의 의견도 들어보면서 서로 크로스 체크할 수 있도록 하고 최종 결정은 CTO가 한다"

**검증된 매핑 후보**:
- CrewAI `manager_agent` 패턴 — Tasks 의 `agent` 가 BE 인데 `manager_agent` 가 CTO. CTO 가 BE 산출 검토 후 approve/reject.
- 현재 [preview-gate/](../../../src/preview-gate/) 가 사용자 ✅ 게이트 인 것을 CTO 게이트로 확장 검토.

**구현 영향**: PreviewAction schema 에 `decisionMaker: 'USER' | 'CTO_AGENT'` 필드 추가 가능성.

### 4.4 PO 분산 → 통합

**현재**: Work Reviewer / PO Shadow / Impact Reporter 가 별도 모듈 + 별도 슬래시.

**재구성 안**:
- 단일 `/po` 슬래시 (사용자 트리거) — daily/weekly 모드.
- 내부 sub-action 으로 worklog / shadow review / impact report 호출.
- 새 sub-action: 이력서용 정리.
- 모듈 통합 vs facade 만 통합 — 결정 필요 (DDD 컨벤션 영향).

**위험**: 기존 Slack manifest 의 슬래시 표 변경. README 동기. AGENTS.md §3 도메인 표 갱신.

### 4.5 PM 외부 통합 우선순위 재정렬

**현재 우선순위** (코드 기준):
1. Slack (수집·반응)
2. GitHub (assigned)
3. Notion (Daily Plan)

**비전 추가 6종 우선순위 (검증 기반)**:
1. **Gmail** — Lindy AI 검증 (`lindy.ai/pricing`) — **추가 권장**
2. Figma — 모든 외부 사례 `not verified` — **보류**
3. Naver — 외부 검증 사례 없음 — **보류**
4. 중복 제거 알고리즘 — Linear Triage 패턴 (`linear.app/docs/triage-intelligence`) — **차용 검토**

---

## 5. 변경 영향 평가 (Code / Schema / Slack / 문서)

| 변경 | 코드 영향 | Prisma schema 영향 | Slack manifest 영향 | 문서 영향 |
|---|---|---|---|---|
| CTO 신설 | 신규 도메인 [src/agent/cto/](../../../src/agent/) | AgentType enum 추가, AGENT_TO_PROVIDER 매핑 | 슬래시 추가 (`/cto-*`) | AGENTS.md §3, README, CLAUDE.md |
| CEO 신설 | 신규 도메인 [src/agent/ceo/](../../../src/agent/) | 동일 + 컨텍스트 오염 메트릭 테이블 검토 | 슬래시 또는 cron 만 | 동일 + 새 cron 운영 가이드 |
| PO 통합 | 3개 모듈 → facade 또는 통합 | PrReviewOutcome 등 기존 테이블 보존 | 슬래시 단일화 또는 새 alias | README 슬래시 표 — 큰 변경 |
| Gmail 통합 | 신규 [src/gmail/](../../../src/) | 토큰 저장 테이블 (OAuth) | — | env 4곳 동기 (.env.example + .env + app.config + README) |
| 통신 토폴로지 결정 | 모든 에이전트 영향 (큰 변경) | EvidenceRecord 활용 + 신규 메시지 테이블? | — | AGENTS.md, CLAUDE.md |
| PoExpand 정식 deprecate | 슬래시/모듈 제거 | AgentType enum 한 항목 정리 | 슬래시 표 1줄 삭제 | README, AGENTS.md |

---

## 6. 권장 진행 순서

외부 검증 + 갭 분석 종합 추천 (의존성 그래프 기준):

```
1. 통신 토폴로지 결정 plan      (전제, 1주)
       ↓
2. 워크플로우 phase 정의 plan    (#1 의존, 1주)
       ↓
3a. PO 통합 plan                 (독립, 2주)
3b. PM Gmail 통합 plan           (독립, 2주)
       ↓
4. CTO 신설 plan                 (#1, #2 의존, 3~4주)
       ↓
5. CEO 신설 plan                 (#4 의존, 3~4주)
       ↓
6. 컨텍스트 오염 점검 알고리즘    (#5 일부, R&D 성격, N=가변)
```

**총 견적**: 12~17주 (3~4 개월) — 단 #1, #2 결정이 늦어지면 전체 지연.

대안 sequencing — **사용자 가시 가치 우선**:
- 3a (PO 통합) + 3b (PM Gmail) 부터 시작 → 사용자 일상 가치 즉시 ↑.
- #1, #2 는 병행 결정 → CTO/CEO 로 진입.

---

## 7. 한계 / 가정

- **사용자 "이상론적 CODE_RULE" 미공유**: BE 자율 개발의 prompt-time 강제 항목 미정. 도입 시점은 사용자 공유 후.
- **컨텍스트 오염 정의 미공식화**: 외부 선례 0 — 자체 정의 후 plan 분기 필요.
- **개인 일정의 Notion 적재**: 비전에 명시되나 schema/UX 미정.
- **이력서 schema**: 후보 제시했지만 사용자 형식 (커리어 페이지/노션 템플릿 등) 미공유.
- 본 분석은 **2026-05-05 시점 commit `92193fd`** 기준. 다음 commit 발생 시 재평가.

---

## 8. 변경 이력

| 날짜 | 변경 |
|---|---|
| 2026-05-05 | 최초 작성. 11개 에이전트 → 5포지션 매핑 + 갭 분석. 권장 sequencing 12~17주. |

— 작성: Claude (Opus 4.7), 2026-05-05
— 갱신 trigger: 통신 토폴로지 결정 / CTO·CEO 신설 / PO 통합 plan 결정 시 즉시
