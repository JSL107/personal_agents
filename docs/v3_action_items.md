# 이대리 V3 — 외부 사례 차용 기반 고도화 액션 아이템 (2026-04-27)

## 0. 결론 한 줄

Hermes Agent (Nous Research) 와 OpenClaw 두 GA 프로젝트와 비교 후 **이대리에 즉시 가치 있는 5개 차용 후보** 를 가성비 순으로 정리. Phase 1 만 우선 구현 대상이며 나머지는 사용자 피드백 후 단계별 진행.

> 이 문서는 plan 만 정의 — 코드 수정 없음. v2 문서 (이미 구현 완료, `docs/archive/v2_ideation_action_items.md`) 의 후속.

---

## 1. 배경 — 외부 사례 비교 요약

| 차원 | Hermes Agent | OpenClaw | 이대리 |
|---|---|---|---|
| 정체성 | 자가 개선 + RL 환경 가능한 연구용 general-purpose | 20+ 채널 + Live Canvas + Wake/Talk 음성, 소비자용 personal assistant | Slack 한 워크스페이스의 PM/BE/Code Reviewer/Work Reviewer/PO Shadow 역할별 워크플로 |
| 채널 | Telegram, Discord, Slack, WhatsApp, Signal, Email | 20+ (위 + iMessage, Teams, Matrix, WeChat...) | Slack only |
| 모델 | OpenRouter 200+ / OpenAI / 커스텀 endpoint | OAuth 기반 ChatGPT/Codex 등 | codex/claude/gemini CLI (구독 quota) |
| 영속성 | LLM 요약 메모리 + FTS5 세션 검색 | `~/.openclaw/workspace` 로컬 | Postgres (Prisma) — AgentRun/EvidenceRecord/PreviewAction/DailyPlan |
| 확장 단위 | autonomous skill 자동 생성 | bundled/managed/workspace skills | DDD bounded context |
| 작업 게이트 | 없음 | sandbox (Docker/SSH/OpenShell) | Preview Gate (PO-2) |
| 학습 루프 | closed loop — 사용 중 skill 자동 개선 | 없음 | 없음 |

**이대리만의 강점**: schema-strict 출력 (DailyPlan/BackendPlan/PullRequestReview), 모든 호출 evidence-tracked (`AgentRun` + footer), Preview Gate 동의 게이트, PII Redaction Layer, 한국어 도메인 모델 (이월/체크인/임팩트 보고).

**이대리 약점**: 정적 prompt (사용자 패턴 학습 없음), 1일 lookback 한계, Slack 외 진입점 없음, prompt 튜닝 시 재컴파일 필요.

---

## 2. 차용 후보 — 가성비 매트릭스

| Phase | 차용 출처 | 변경 규모 | 가치 | 리스크 | 우선순위 |
|---|---|---|---|---|---|
| 1. 장기 컨텍스트 — 지난 N일 plan 요약 | Hermes cross-session memory | 소 (~2h, 새 테이블 X) | 高 | 낮음 | **★ 즉시** |
| 2. Plan/worklog FTS 인덱스 + `/find` 명령 | Hermes FTS5 | 중 (~3h, GIN + tsvector) | 中 | 낮음 | 다음 |
| 3. Prompt/format 외부화 (`.prompt.md` 로더) | OpenClaw SKILL.md | 중 (~3h, 보간 syntax 결정) | 中 | 중 (보간/타입 안전성) | 다음 |
| 4. Skill 동적 등록 시스템 | OpenClaw skill 패키지 | 대 (수일, DI 패턴 전환) | 中 | 高 (architecture) | 보류 |
| 5. 멀티채널 게이트웨이 (Telegram/Discord) | OpenClaw multi-channel | 대 | 低 — 1인 Slack 워크플로엔 과잉 | 중 | 보류 |

---

## 3. Phase 1 — 장기 컨텍스트 (지난 N일 plan 요약)

### 3.1 문제

`/today` 의 PM agent 가 보는 외부 컨텍스트 5종 중 **직전 PM 실행은 N=1 (가장 최근 1건) 만**.
→ "어제" 만 보이고 그 이전 패턴은 invisible.

→ critical path / rollover 판단이 어제 한 건에만 의존. "이 PR 리뷰 task 가 5일 연속 등장중" 같은 신호 누락.

### 3.2 변경

#### [MODIFY] `src/agent/pm/application/daily-plan-context.collector.ts`
```ts
const RECENT_PLAN_LOOKBACK_DAYS = 7;

interface RecentPlanSummary {
  date: string;          // YYYY-MM-DD (KST)
  topPriorityTitle: string;
  estimatedHours: number;
  criticalPathCount: number;
  agentRunId: number;
}

interface DailyPlanContext {
  // ... 기존 필드 ...
  recentPlanSummaries: RecentPlanSummary[]; // 신규 — 직전 N일 plan 한 줄 요약
}

private async fetchRecentPlanSummariesOrEmpty(): Promise<RecentPlanSummary[]> {
  // AgentRunService.findRecentSucceededRuns({ agentType: PM, sinceDays: 7, limit: 7 })
  // 각 run 의 output 을 coerceToDailyPlan 으로 narrowing 후 한 줄 요약으로 변환
  // 실패는 graceful — 빈 배열 반환
}
```

#### [NEW or MODIFY] `src/agent-run/application/agent-run.service.ts`
- `findRecentSucceededRuns(input: { agentType, sinceDays, limit }): Promise<SucceededAgentRunSnapshot[]>` 추가
- 기존 `findLatestSucceededRun` 의 N→1 special case 와 일관 (sinceDays 윈도우 + limit cap).

#### [MODIFY] `src/agent-run/domain/port/agent-run.repository.port.ts`
- 위 메서드 시그니처를 port 에 추가 (Prisma 어댑터 구현).

#### [MODIFY] `src/agent-run/infrastructure/agent-run.prisma.repository.ts`
- `findMany({ where: { agentType, status: SUCCEEDED, endedAt: { gte: cutoff } }, orderBy: { endedAt: desc }, take: limit })`.

#### [MODIFY] `src/agent/pm/application/daily-plan-prompt.builder.ts`
- 새 섹션 `## 지난 7일 plan 패턴` — 한 plan 당 한 줄.
  ```
  - 2026-04-26 — 최우선: PM-2 Write-back 마무리 (5h, ⚠1건)
  - 2026-04-25 — 최우선: OPS-1 Quota Pane 구현 (6h, ⚠0건)
  ```
- truncation 로직에 새 섹션 우선순위 부여. 실제 drop 순서는 `slackMentions → recentPlanSummaries → previousWorklog → previousPlan` (인덱스 0 부터 차례로 drop). userText / github / notion 은 빈 입력 회귀 (codex review b1309omm0 P2) 방지를 위해 drop 대상에서 제외한다.

#### [MODIFY] `src/agent/pm/domain/prompt/pm-system.prompt.ts`
- 추가 가이드:
  ```
  ## 지난 N일 패턴 활용
  - "지난 7일 plan 패턴" 섹션의 topPriority 추이를 본다.
  - 같은 task 가 3일 이상 topPriority 로 등장하면 → 분해 (subtasks) 또는 위임 검토.
  - estimatedHours 가 매일 7h 초과면 → 오늘 의도적으로 축소 또는 blocker 명시.
  ```

#### [MODIFY] `src/agent/pm/domain/pm-agent.type.ts`
- `DailyPlanInputSnapshot` 에 `recentPlanLookbackDays: number` + `recentPlanSampleCount: number` 추가 (관측성).

### 3.3 토큰 영향

- 7 plans × 평균 70자 ≈ 500자 ≈ 250 tokens.
- 현재 prompt cap 은 대부분 ~3-5KB 라 안전.
- truncation 로직이 새 섹션도 cap 안에 들어가도록 처리.

### 3.4 검증

#### Automated Tests
1. `daily-plan-context.collector.spec.ts` — `fetchRecentPlanSummariesOrEmpty` 가 N건 정상 반환, 일부 coerce 실패 시 skip 후 빈 배열로 fallback.
2. `daily-plan-prompt.builder.spec.ts` — `recentPlanSummaries` 가 비어있을 때 섹션 자체를 안 만든다 (불필요한 빈 섹션 방지).
3. `daily-plan-prompt.builder.spec.ts` — 새 섹션이 truncation 우선순위에 맞게 drop 된다 (전체 cap 초과 시).
4. `agent-run.prisma.repository.spec.ts` (있다면) — `findRecentSucceededRuns` 의 sinceDays 컷오프 정확.

#### Manual
- `/today` 호출 → 응답에 직접 변경 없음 (PM agent 의 추론 입력만 풍부해짐).
- AgentRun.inputSnapshot 에 `recentPlanLookbackDays=7, recentPlanSampleCount=N` 박혀있는지 DB 확인.
- 같은 PR 리뷰 task 가 며칠 연속 등장한 케이스에서 PM agent 가 분해 / 위임 권고를 띄우는지 정성 확인.

### 3.5 Out of scope (Phase 1 X)

- LLM 기반 요약 (token 더 절약하려면 N=30 이상 필요할 때 도입).
- 사용자별 cross-workspace memory (`/who-am-i` 같은 명령).
- Eisenhower 매트릭스 자동 분류 (현재 prompt 가이드만 — 별도 라벨링 X).

---

## 4. Phase 2 — FTS 검색 (`/find <키워드>`)

### 변경 (간략)
- Postgres `tsvector` generated column + GIN 인덱스를 `agent_run.output` 에 추가 (Prisma migration).
- `SearchAgentRunsUsecase` 신규 — agentType 필터 + tsquery 매칭 + paginated 결과.
- `/find <키워드>` Slack 슬래시 명령 (handler 는 diagnosis.handler 에 추가) — 모델 호출 없이 DB query 만, 즉시 응답.

### 가치 시나리오
- "결제 검증 API 작업 마지막에 언제였지?" → `/find 결제 검증` → 등장한 plan 7건 + 날짜.
- "이 코드 리뷰는 어떤 PR 이었지?" → `/find PR #34` → 즉시 회상.

---

## 5. Phase 3 — Prompt/format 외부화

### 변경 (간략)
- `prompts/` 디렉터리 신규 — `pm-system.prompt.md`, `code-reviewer-system.prompt.md` 등.
- 보간 syntax: `{{varname}}` 또는 `${varname}` 결정 필요.
- 부팅 시 `PromptRegistry` 가 fs.readFileSync + 컴파일.
- 기존 `*.prompt.ts` 파일은 thin re-export 로 단계 이전 (한 번에 다 옮기지 않음).

### 리스크
- 타입 안전성 손실 (현재 TS template literal 이라 미사용 변수 / 미정의 변수 컴파일 에러).
- 보간 syntax 가 자체 mini-language 가 됨.

### 대안
- TS template literal 그대로 두고 prompt 만 별도 파일로 빼지 말고 그냥 코드로 둔다.
- 가치는 "재컴파일 없이 prompt 튜닝" 인데, 운영자가 코드 수정 가능하다면 별 차이 없음.

→ **Phase 3 는 도입 보류 추천.** 코드로 두는 게 type-safe + IDE 지원 + 검증 용이.

---

## 6. Phase 4 — Skill 동적 등록 (보류)

- NestJS DI 는 컴파일 타임 — 동적 skill 추가하려면 별도 registry 패턴 필요.
- 1인 사용 시 가치 낮음 (운영자 = 개발자라 PR 추가가 자연).
- 다인 사용으로 확장 시 재검토.

## 7. Phase 5 — 멀티채널 (보류)

- Slack 의존이 깊지 않은 부분 (handler 만) 만 추출하면 가능하나 ROI 낮음.
- Slack 외 진입점 요구 발생 시 재검토.

---

## 8. 다음 액션 (당일 실행 권고)

1. 본 문서 review 후 Phase 1 구현 착수 OK 판단.
2. Phase 1 구현 (예상 ~2시간):
   - Repository port + Prisma 어댑터 — 30m
   - Collector + summary 변환 — 30m
   - Prompt builder + system prompt — 30m
   - 테스트 + 3중 green + codex review — 30m
3. Phase 2/3 는 사용자 사용 후 patterns 보고 재평가.
