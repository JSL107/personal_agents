# 이대리 V2 고도화 아이디어 — 교차검증 / 재귀검증 / 우선순위 (2026-04-27 개정)

> 이 문서는 기존 v2 액션 아이템에 대해 **현재 코드베이스의 실제 상태를 근거로** 교차검증하고, 위험·전제·대안을 재귀적으로 검증한 뒤, 새로 도출된 아이디어까지 포함해 우선순위로 재배열한 결과다.
>
> 검증 근거 파일:
> - [src/agent/pm/domain/pm-agent.type.ts](src/agent/pm/domain/pm-agent.type.ts) — `TaskItem.subtasks` / `isCriticalPath` / `VarianceAnalysis` 이미 존재
> - [src/agent/pm/application/generate-daily-plan.usecase.ts](src/agent/pm/application/generate-daily-plan.usecase.ts) — graceful fallback / 직전 plan·worklog 참조 / `assertNonEmptyInput`
> - [src/agent/po-shadow/po-shadow.module.ts](src/agent/po-shadow/po-shadow.module.ts) — `/po-shadow` 명령 운영 중
> - [src/agent/impact-reporter/impact-reporter.module.ts](src/agent/impact-reporter/impact-reporter.module.ts) — `/impact-report` 명령 운영 중
> - [src/agent/be/be.module.ts](src/agent/be/be.module.ts) — `/plan-task` 명령으로 BackendPlan 텍스트 산출
> - [package.json](package.json) — `@nestjs/schedule` / pgvector / langchain 미설치, `@nestjs/bullmq` 는 설치됨
> - [AGENTS.md](AGENTS.md) §5 / §6 — CLI subscription 격리·Prisma 단일 ORM·HOME throwaway 보안 원칙

---

## 0. 결론 한 줄 요약

| | 권고 |
|---|---|
| 즉시 시작 (Quick Win) | **PRO-1 Morning Briefing CRON**, **PRO-2 Plan Diff 라벨링**, **PRO-3 모델 라우팅 응답 푸터 노출** |
| 다음 스프린트 | **PM-2 Write-back (idempotency 우선)**, **OPS-1 Cost / Quota Pane**, **PO-2 Dry-run / Preview Gate** |
| 보류 / 재설계 | **BE-1 Zero-to-Code**, **OPS-3 n8n 연동**, **PM-3 예측형 RAG** (전부 비용·보안·정체성 충돌) |
| 폐기 | **OPS-4 "Polling 로직 제거"** — 사실관계 오류 (현재 코드에 polling 없음) |

---

## 1. 기존 액션 아이템 교차검증 (Status × 위험 × 코드 근거)

### §1 PM Agent 고도화

| 액션 | 현재 상태 | 근거 | 권고 |
|---|---|---|---|
| WBS 분할 프롬프트 | **이미 적용** | `TaskItem.subtasks: SubTask[]` ([pm-agent.type.ts:18](src/agent/pm/domain/pm-agent.type.ts#L18-L24)) + `pm-system.prompt` 의 "2시간 룰" | 액션 종료. 효과 측정 메트릭(`subtasksCount` 평균) 만 추가. |
| 역동기화(Write-back) | **미구현** | `src/agent/pm/application/` 에 `sync-daily-plan.usecase.ts` 없음 | **PM-2** 로 진행 (단 idempotency 가 필수 — §2 재귀검증) |
| 예측형 RAG | **미구현 + 재설계 필요** | pgvector / langchain 미설치, 데이터 N≪1000 | **PM-3** 로 격하·**FTS 우선** 대안 (§2 재귀검증) |
| 자율 이월 (Eisenhower) | **이미 적용** | `VarianceAnalysis.analysisReasoning` ([pm-agent.type.ts:28-31](src/agent/pm/domain/pm-agent.type.ts#L28-L31)) + `formatDailyPlan` 의 "어제 이월" 섹션 ([slack.service.ts:558-567](src/slack/slack.service.ts#L558-L567)) | 액션 종료. 단 **per-task drop/postpone 라벨**은 미흡 → **PM-1** 로 분리. |

### §2 PO Agent 고도화

| 액션 | 현재 상태 | 근거 | 권고 |
|---|---|---|---|
| PRD 자동 생성 (`/po-expand`) | **미구현** | po-shadow 모듈은 검토 전용, 생성 모듈 없음 | **PO-1** 로 진행. 다만 **stage gate (outline → expand)** 강제 (§2 재귀검증) |
| Impact Challenger 훅 | **부분 구현** | `/impact-report` 슬래시는 수동 호출만 — PR open/이슈 등록 자동 훅 없음 | **PO-3** 로 격하 — 자동 훅은 GitHub Webhook 이 들어와야 가능하므로 **OPS-2 단일 webhook 수신부** 선행 필요 |

### §3 BE Agent (Autonomous Coding)

| 액션 | 현재 상태 | 근거 | 권고 |
|---|---|---|---|
| Zero-to-Code 파이프라인 | **위험 — 보류** | `/plan-task` 는 텍스트 BackendPlan 만 산출 ([be-agent.type.ts](src/agent/be/domain/be-agent.type.ts)). 자동 파일 수정 / push 미구현 | **BE-1** 로 명명·**보류**. 대신 **BE-2 prompt-package export** 로 대체 (§2 재귀검증) |
| Draft PR 자동화 | **위험 — 부분만** | Octokit 어댑터 read-only ([github 모듈](src/github)) | **BE-3** — *PR description 만* 자동 생성, 코드 push 는 인간 |
| Self-Healing 테스트 루프 | **위험 — 보류** | CI 후크 미연결, CLI 쿼터 폭주 위험 | **BE-4** — `max_attempts=3` + `cost ceiling` 게이트 후 진행 |

### §4 배치 처리 고도화

| 액션 | 현재 상태 | 근거 | 권고 |
|---|---|---|---|
| Morning Briefing CRON | **미구현** | `@nestjs/schedule` 미설치, BullMQ 는 있음 | **PRO-1** — 가성비 1순위. BullMQ Repeatable Jobs 로 구현 (의존성 0 추가) |
| Weekly Batch Summarizer | **미구현** | 동일 | **PRO-4** — Morning Briefing 검증 후 |

### §5 Zero-Code (n8n / Webhook / Polling 제거)

| 액션 | 현재 상태 | 사실관계 | 권고 |
|---|---|---|---|
| n8n / Zapier 연동 | **재설계** | 이대리 정체성([AGENTS.md §0](AGENTS.md))은 자체 호스팅 NestJS — n8n 도입은 운영 부담 추가, 가치 < 비용 | **반대**. 대신 **OPS-2 단일 webhook 수신부** 만 자체 구현 |
| 단일 Webhook (`POST /v1/agent/trigger`) | **미구현 (가치 ○)** | 현재 진입점은 Slack 슬래시뿐 | **OPS-2** 로 채택 — n8n 없이도 가치 있음 |
| Polling 로직 제거 | **사실관계 오류** | 현재 코드 어디에도 polling 없음 — 모든 외부 호출은 슬래시 호출 시 on-demand + graceful fallback | **폐기** |

---

## 2. 재귀검증 — 각 액션의 위험·전제·대안

### PM-2 Write-back (양방향 동기화)

**Failure modes**
1. **중복 누적**: `/today` 가 매일 같은 issue 에 동일 체크리스트를 추가 → issue 코멘트 폭증.
2. **잘못된 분해의 영구 박힘**: 모델이 잘못 쪼갠 subtask 가 진짜 GitHub Issue 에 commit 됨.
3. **권한 확장**: GitHub `repo:write` / Notion edit scope = 토큰 침해 시 영향도 ↑.

**전제 검증** — 이대리는 1인 사용자 봇이다. write 가 잘못되면 **사용자 본인의 워크아이템이 오염**되는 셈. UX 임팩트는 의외로 큼.

**대안 / 보호 게이트**
- **Idempotency key**: `(plan_date, source_id, task_hash)` 로 중복 차단. Notion 은 page property 에, GitHub 은 hidden marker (`<!-- jarvis:wbs:{hash} -->`) 로.
- **Preview-then-confirm**: 첫 도입 시 Slack Block Kit 으로 미리보기 → ✅ 클릭 시에만 write. (PO-2 와 통합)
- **scope 최소화**: GitHub 토큰을 `issues:write` 만, Notion 을 page-scoped integration 으로 격리.

### PM-3 예측형 RAG → FTS 로 강등

**전제 검증**
- pgvector 도입 = Prisma + 의존성 추가 + 인덱스 운영 부담.
- 데이터 양: AgentRun row 수가 1000 미만이면 RAG 의 임베딩 비교는 **단순 Postgres FTS(`tsvector` + GIN)** 와 정확도 차이 미미.
- AGENTS.md §6: 모델 호출은 **CLI subscription quota 기반**, API key 미사용 원칙. 임베딩 생성에 별도 API 도입은 정체성 충돌.

**대체안 (PM-3')**
- `agent_run.input_snapshot` / `output` 의 텍스트 컬럼에 `tsvector` 생성 컬럼 + GIN 인덱스.
- PM 프롬프트에 `[과거 유사 plan top 3]` 섹션 추가 — `ts_rank` 로 가장 유사한 직전 N개 plan reasoning 만 주입.
- 비용 0, 응답성능 보존.

### BE-1 Zero-to-Code 보류 사유

**보안 (AGENTS.md §5 와 직접 충돌)**
- `claude` CLI 를 NestJS 안에서 spawn 후 자유 file write/git push 권한 부여 = `cwd` lockdown / throwaway HOME 원칙 무력화.
- subscription quota 가 1인 사용자 owner 의 것이므로 폭주 시 즉시 quota 소진 + Slack 응답 전체 중단.

**대체안 (BE-2)**
- `/plan-task` 결과 `BackendPlan` 을 **`.md` prompt-package** 로 떨어뜨리고, 사용자가 별도 `claude` 세션에서 실행. 책임 경계가 명확해짐.
- 또는 GitHub Issue 본문에 **"이 prompt 로 claude 에 붙여넣기"** 한 줄 추가.

### PO-1 PRD 자동 생성 (`/po-expand`) — Stage Gate 필수

**Failure mode**: 한 줄 → PRD 단계는 hallucination 폭탄 (도메인 모르는 상태로 user story 30개 양산).

**Gate 설계**
1. Stage 1: 한 줄 → **3~5 줄 outline + clarifying questions** 만 생성.
2. 사용자 ✅ 클릭 시 Stage 2: outline → 전체 PRD.
3. Notion write 는 PO-2 Dry-run 게이트 통과 후에만.

### OPS-3 n8n 반대 의견

- 현재 외부 통합은 GitHub / Notion / Slack 3개 — 모두 NestJS 어댑터로 직접 처리 중. 운영 surface 가 작음.
- n8n 도입 = 별도 호스팅 + 별도 인증 + 별도 백업 + 워크플로우 정의가 코드 밖에 분산.
- "Zero-Code" 라는 말의 함정: **유지보수 부하가 줄어드는 게 아니라 다른 시스템으로 이전**될 뿐. 1인 사용자에게는 손해.

---

## 3. 신규 아이디어 (재귀검증 중 발굴)

### PRO 계열 — 즉시 가성비

- **PRO-1 Morning Briefing CRON**
  - BullMQ Repeatable Job 으로 매일 08:30 KST 에 `GenerateDailyPlanUsecase` 호출 → Slack DM 발송.
  - 의존성 0 추가 (`@nestjs/bullmq` 이미 설치).
  - 위험: 사용자가 수동으로 `/today` 도 호출하면 같은 날 plan 이 2개. → `daily_plan` upsert 키가 `plan_date` 단일이므로 자연스럽게 덮어쓰기. OK.

- **PRO-2 Plan Diff 라벨링**
  - 현재 `varianceAnalysis.rolledOverTasks` 는 "이월 됐다" 만 알려줌.
  - 추가: `[NEW]` / `[CARRIED]` / `[DROPPED]` / `[POSTPONED]` 4개 라벨로 어제↔오늘 비교 노출.
  - 변경 폭: prompt + parser 만, 스키마는 `TaskItem` 에 `lineage: 'new' | 'carried' | …` 추가 1개 필드.

- **PRO-3 모델 라우팅 응답 푸터**
  - 모든 `/today /worklog /review-pr /plan-task /po-shadow /impact-report` 응답 마지막에 ` _model: codex-cli (chatgpt) · run #42_` 한 줄.
  - 디버깅·품질 회고에 essential. 이미 `CompletionResponse.modelUsed` 가 흘러다니므로 formatter 만 수정.

- **PRO-4 Weekly Summarizer** — PRO-1 검증 후, 금요일 17:00 에 Work Reviewer 자동 기동.

### PO / BE 계열 — 안전 게이트 우선

- **PO-2 Dry-run / Preview Gate (전 Write 명령 공통)**
  - PM Write-back / PO PRD 작성 / BE Draft PR description 모두 **공통 preview 모듈**로.
  - Slack Block Kit `actions` 블록 (✅ apply / ❌ cancel) → DB 임시 row → 클릭 시 실제 write.
  - AGENTS.md "executing actions with care" 원칙과 합치.

- **BE-3 PR Description Auto-Drafter**
  - Zero-to-Code 보류 동안의 안전한 슬라이스. **읽기는 read-only Octokit, 쓰기는 PR body 만** (브랜치 push 는 사람).
  - `/draft-pr <branch>` 슬래시 → diff 분석 → PR title/body 초안만 생성.

- **BE-4 Self-Healing (게이트 명세)**
  - 진행 조건: `max_attempts=3`, `total_cli_minutes <= 5`, `branch matches /^auto\//`.
  - 실패 시: 사용자에게 Slack alert + 자동 종료. 폭주 차단.

### OPS 계열 — 운영 가시성

- **OPS-1 Cost / Quota Observability Pane**
  - `agent_run` 에 `cli_provider` / `duration_ms` / `quota_estimated` 컬럼 추가 (Prisma 스키마 변경 + `db:push`).
  - `/quota` 슬래시: 오늘/이번주 실행 수 + 추정 quota 소진율.
  - 코드 변경 후 lint:check + test + build 3중 green ([AGENTS.md §1](AGENTS.md)) 필수.

- **OPS-2 단일 Webhook 수신부 (`POST /v1/agent/trigger`)**
  - n8n 없이 직접 구현. GitHub webhook (issue.opened, pr.opened) → `/impact-report` 자동 트리거 → PO-3 Impact Challenger 훅 가능해짐.
  - HMAC 서명 검증 필수 (외부 입력 boundary).

- **OPS-3 Slack Reaction → Inbox**
  - 본인이 받은 메시지에 ✋ reaction 달면 익일 `/today` 가 자동 흡수.
  - 이미 있는 `slack-collector` 모듈 확장 — 큰 수정 아님.

- **OPS-4 PII Redaction Layer (CLI 경계)**
  - GitHub issue body / Slack mention text 가 그대로 외부 모델 (codex/claude) prompt 로 전송 중.
  - Email / Slack 토큰 / AWS key 패턴 redaction → CLI provider 의 stdin 직전.
  - Zero 추가 의존성 (regex 만).

- **OPS-5 Failure Replay**
  - `agent_run.status = FAILED` 인 row 의 `input_snapshot` 으로 동일 prompt 재실행하는 `/retry-run <id>`.
  - 사용자가 매번 자유 텍스트 다시 입력 안 해도 됨.

- **OPS-6 Stale Data Filter ✅ 완료** (60일 default — env `STALE_DATA_CUTOFF_DAYS` override 가능)
  - GitHub Search API 의 `q` 에 `updated:>=YYYY-MM-DD` qualifier 추가 ([octokit-github.client.ts](src/github/infrastructure/octokit-github.client.ts) `invokeSearch`).
  - Notion `databases.query` 에 `last_edited_time` `on_or_after` 필터 추가 ([notion-api.client.ts](src/notion/infrastructure/notion-api.client.ts) `queryDbOrNull`).
  - 공통 컷오프 헬퍼 [`stale-data-cutoff.util.ts`](src/common/util/stale-data-cutoff.util.ts) — usecase 두 곳 (List Assigned / List Active Tasks) 이 ConfigService 로 동일 정책 공유.

- **OPS-7 MorningBriefing Layer 정화 ✅ 부분 완료**
  - 단기: `SlackNotifierPort` ([slack-notifier.port.ts](src/morning-briefing/domain/port/slack-notifier.port.ts)) 도입, `SlackService` 를 `useExisting` 로 bind. Consumer 는 더이상 `SlackService` 를 직접 의존하지 않고 port 만 본다.
  - **장기 (deferred)**: presentation 포맷 함수들 (`formatDailyPlan` / `formatModelFooter`) 을 `src/slack/format/` 디렉토리로 분리해 Consumer 가 Slack 어댑터의 export 를 import 하지 않게 정화. 현재는 함수만 import 하므로 의존방향 위반 정도가 약함.

- **OPS-8 TriggerType 분리 (omc P2 deferred)**
  - Morning Briefing CRON 호출이 현재 `TriggerType.SLACK_COMMAND_TODAY` 로 `agent_run` 에 기록 — 수동 `/today` 와 구분 불가.
  - `TriggerType.MORNING_BRIEFING_CRON` 신규 enum + `GenerateDailyPlanUsecase` 에 `triggerType` override 파라미터 추가.
  - 분석/Failure Replay/Quota Pane (OPS-1) 에서 자동/수동 구분 가능해짐.

- **PM-4 extractSources 선언적 변환 (codex P1 CODE_RULES)**
  - 직전 commit [`refactor(notion): let 제거 + 선언적 변환`](https://github.com) 패턴과 동일하게 `[src/agent/pm/application/generate-daily-plan.usecase.ts](src/agent/pm/application/generate-daily-plan.usecase.ts)` 의 `extractSources` 도 mutable `push` 패턴 → `[...githubSources, ...notionSources, ...]` 선언적 변환.
  - 변경 폭 작음 (한 함수). 회귀 위험 거의 0.

### Quality 계열 — 학습/평가

- **QA-1 Reviewer 룰셋 학습**
  - `/review-pr` 결과 중 사용자가 채택/기각한 history 를 `pr_review_outcome` 테이블로 저장.
  - 다음 리뷰 prompt 에 "이 사용자가 무시한 패턴" 을 negative example 로 1~2개 주입.
  - RAG 보다 가성비 ↑ (작은 데이터셋에서 효과 있음).

- **QA-2 LLM-as-Judge Self-eval (옵션)**
  - PM plan 응답을 다른 모델 (PM=ChatGPT 면 검수=Claude) 에 짧게 던져 0~5점 평가.
  - 비용 ↑, 우선순위 낮음 — Quota Pane 가 먼저.

---

## 4. 우선순위 매트릭스

| 우선 | ID | 제목 | 가치 | 위험 | 의존 |
|---|---|---|---|---|---|
| **P0** | PRO-1 | Morning Briefing CRON | High | Low | 없음 |
| **P0** | PRO-3 | 모델 라우팅 응답 푸터 | Med | Low | 없음 |
| **P0** | PRO-2 | Plan Diff 라벨링 | High | Low | parser 변경 |
| **✅ Done** | OPS-1 | Cost / Quota Pane — `agent_run.cli_provider/duration_ms` + `/quota` 슬래시 | High | Low | — |
| **✅ Done** | PO-2 | Dry-run Preview Gate — `src/preview-gate/` + `PreviewActionPrismaRepository` + Block Kit `actions` + apply/cancel handler | High | Med | — |
| **✅ Done** | PM-2 | PM Write-back — `/sync-plan` + `PmWriteBackApplier` (PreviewGate strategy) | High | Med | — |
| **P1** | OPS-4 | PII Redaction | High | Low | 없음 |
| **P2** | PO-1 | `/po-expand` (stage gate) | Med | Med | PO-2 선행 |
| **P2** | OPS-2 | 단일 Webhook 수신부 | Med | Med | HMAC 검증 |
| **P2** | PRO-4 | Weekly Summarizer | Med | Low | PRO-1 후 |
| **P2** | PM-3' | FTS 기반 유사 plan 추출 | Med | Low | Postgres tsvector |
| **P2** | OPS-3 | Slack Reaction → Inbox | Med | Low | slack-collector 확장 |
| **P2** | OPS-5 | Failure Replay | Low | Low | 없음 |
| **✅ Done** | OPS-6 | Stale Data Filter — 60일 default (env override) | High | Low | — |
| **✅ Done** | OPS-7 | MorningBriefing Layer 정화 — SlackNotifierPort 추출 (presentation 분리는 deferred) | Med | Low | — |
| **P2** | OPS-8 | TriggerType.MORNING_BRIEFING_CRON 분리 | Med | Low | 없음 |
| **P2** | PM-4 | extractSources 선언적 변환 | Low | Low | 없음 |
| **P2** | QA-1 | Reviewer 룰셋 학습 | Med | Low | review history 테이블 |
| **P3** | BE-3 | PR description auto-draft | Med | Med | Octokit write scope |
| **P3** | PO-3 | Impact Challenger 자동 훅 | Med | Med | OPS-2 선행 |
| **Hold** | BE-1 | Zero-to-Code 파이프라인 | High | **High** | 보안 재설계 필요 |
| **Hold** | BE-4 | Self-Healing 테스트 루프 | High | **High** | BE-1 선행 + cost ceiling |
| **Hold** | PM-3 | 예측형 RAG (벡터) | Med | High | PM-3' 가 대체 |
| **Drop** | OPS-3' | n8n / Zapier 연동 | Low | High | 정체성 충돌 |
| **Drop** | — | "Polling 제거" | — | — | 사실관계 오류 |

---

## 5. 다음 액션 (당일 실행 권고)

1. **PRO-3** 부터 — formatter 한두 곳만 손보면 끝, 전 명령에 `_model: …_` 푸터 노출. 가시성 즉시 개선.
2. **PRO-1 Morning Briefing** — BullMQ Repeatable Job 1개 + `daily-plan` upsert 검증으로 마무리. 의존성 0.
3. **OPS-1 Quota Pane** 의 Prisma 컬럼만 먼저 (`db:push`) — 운영 가시성 확보 후 다음 P1 진행.
4. PM-2 Write-back 은 **PO-2 Preview Gate 와 묶어서** 한 PR 로. 단독 진행 시 idempotency 누락 회귀 위험.

> 모든 코드 변경 후 [AGENTS.md §1](AGENTS.md) 의 `pnpm lint:check && pnpm test && pnpm build` 3중 green 필수. commit 은 사용자가 명시적으로 요청한 시점에만.
