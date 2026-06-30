# 아침 "오늘 할 일" 브리핑 고도화 — 완료/대기 판단 + 윤문 — 설계

- 날짜: 2026-06-30
- 상태: 설계 승인됨 (구현 전)
- 범위: 아침 자동 브리핑 (`TriggerType.MORNING_BRIEFING_CRON`) 한정. 수동 `/today`는 무변경.
- **base**: `origin/main` = `68fface` (#121 머지 후). 최초 초안은 stale main(#119)에서 작성됐다가 worktree(origin/main)에서 **재검증·개정**됨 — §0 참조.
- 관련 메모: `reference_humanize_korean_skill`, `project_idaeri_autopilot_vision`, `project_token_overconsumption`, `feedback_docs_sync_check`, `feedback_worktree_absolute_path`

## 0. 재검증 메모 (중요)

최초 설계는 로컬 main(#119)을 읽고 작성돼 "윤문 인프라 미구현"으로 판단했으나, **origin/main은 이미 #121 `feat(autopilot): 자동 보고서 윤문(humanize) + 가독성`까지 머지**된 상태였다. 따라서:

- `src/humanize/`(`HumanizeService`, `humanize-report.adapter.ts`, `humanize-system.prompt.ts`, `humanize-output.parser.ts`)와 `AgentType.HUMANIZER`(=CHATGPT, route 양방향 fallback)는 **이미 존재**한다.
- autopilot task는 `AutopilotTaskResult = { skip, summaryText?, detailText? }`로 리팩터됐고, 보고서 task들은 `humanizeXxx(outcome.result, humanizeService)` → formatter 패턴으로 윤문을 적용 중이다([impact-report.autopilot-task.ts:52-60](../../../src/autopilot/infrastructure/tasks/impact-report.autopilot-task.ts#L52-L60)).
- 단, **#121은 "자동 보고서(Impact/CEO/Worklog) 한정"**이라 PM 데일리플랜(morning briefing)은 윤문 대상에서 빠져 있다. PM 데일리플랜 코어(usecase/collector/prompt/formatter, GitHub 모듈)는 #120/#121이 건드리지 않아 본 설계 기준 그대로다.

→ 결과: **파트 2(윤문)는 "새로 만들기"가 아니라 "기존 `HumanizeService` 재사용 + 데일리플랜 어댑터 1개 추가"로 축소**된다.

## 1. 배경 / 문제 (Why)

매일 08:30 KST 발송되는 "오늘 할 일" 체크인 브리핑에 대해 사용자가 두 가지를 지적:

1. **이미 끝났거나 "내 차례가 아닌(대기 중)" 작업을 판단하지 못하고 무조건 보냄.**
   - 파이프라인: cron → [morning-briefing.autopilot-task.ts](../../../src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts) → [generate-daily-plan.usecase.ts](../../../src/agent/pm/application/generate-daily-plan.usecase.ts) → 컨텍스트 수집([daily-plan-context.collector.ts](../../../src/agent/pm/application/daily-plan-context.collector.ts)) → ChatGPT(PM)가 JSON 생성 → [daily-plan.formatter.ts](../../../src/slack/format/daily-plan.formatter.ts) 렌더.
   - **완료/대기 판단 신호가 사실상 `isApproved` 하나뿐**이다([github.type.ts:21](../../../src/github/domain/github.type.ts#L21)). 아침 브리핑은 이 approved PR만 거른다([generate-daily-plan.usecase.ts:97](../../../src/agent/pm/application/generate-daily-plan.usecase.ts#L97), `excludeApprovedPullRequests`).
   - "내가 QA 코멘트를 이미 남겼다 / 머지만 남았다 / 다른 리뷰어·CI 대기 중이다"처럼 **'내 차례는 끝난' 상태를 구분하는 신호가 전혀 없다.** assigned + open + 미승인이면 매일 무조건 최우선 후보로 LLM 프롬프트에 들어가고, LLM은 우선순위만 매긴다([github-task-formatter.ts:42-54](../../../src/agent/pm/domain/prompt/github-task-formatter.ts#L42-L54) — 노출 라벨은 `[draft]`/`[APPROVED]`뿐).
   - 증상: "채팅방 노출 PR이 지난 7일 중 3일 이상 최우선으로 반복".

2. **AI가 쓴 티가 난다(윤문 안 됨).**
   - 서술 문장(`reasoning`, `varianceAnalysis.analysisReasoning`, `blocker`)을 ChatGPT가 JSON으로 생성하고, formatter가 `*예상 소요*: 4시간`, `_이월 근거_: …` 같은 기계적 템플릿으로 렌더([daily-plan.formatter.ts:34-71](../../../src/slack/format/daily-plan.formatter.ts#L34-L71)).
   - #121 윤문은 "보고서 한정"이라 **이 데일리플랜은 윤문 경로를 거치지 않는다**.

## 2. 목표 / 비목표

### 목표 (What)
- 아침 브리핑에서 **이미 끝났거나 내 차례가 아닌(대기 중) PR을 코드로 판단**해, 최우선/오전/오후에서 빼고 별도 **"🕓 대기 중 (확인만)"** 섹션으로 강등한다(드랍 X).
- 데일리플랜의 **서술 문장만**(`reasoning`/`analysisReasoning`/`blocker`) 기존 `HumanizeService`로 윤문한다(의미·수치·고유명사·`#PR번호`·URL·순서·개수 불변).
- 두 기능 모두 **graceful** — 실패해도 브리핑은 정상 발송. 토글로 끄면 기존 동작과 동일.

### 성공 기준
- 내가 최근 검토/코멘트를 남겼거나 머지만 남은 assigned PR이 최우선/오전/오후에 더는 안 뜨고 "대기 중" 섹션에 사유와 함께 노출된다.
- `reasoning`/`analysisReasoning`/`blocker`가 윤문되며 수치·고유명사·`#PR번호`·URL은 한 글자도 안 바뀐다.
- 분류·윤문 호출이 실패해도 브리핑 발송 자체는 성공한다.

### 비목표 (Non-goals)
- 수동 `/today` 경로 변경(직접 호출 의도 존중 — 전부 노출 유지).
- 이슈(non-PR) 완료/대기 판단(이번엔 PR 한정).
- #121의 요약/스레드 분리 가독성 구조 변경(이미 머지됨 — 그대로 활용).
- 리포트(Impact/CEO/Worklog) 윤문 변경(#121 소관).
- 새 슬래시 명령·새 `AgentType`·새 humanize 모듈 추가(모두 이미 존재).

## 3. 사용자 확정 결정

| 항목 | 결정 |
|---|---|
| 대기 작업 처리 | **별도 "대기 중" 섹션으로 강등**(드랍 X) |
| 판단 신호 | **내 활동(최근 코멘트/리뷰) + 볼 위치(머지/CI/타리뷰어 대기) 둘 다** |
| 윤문 방식 | **기존 humanize 파이프라인 재사용**(#121의 `HumanizeService`) |
| 적용 범위 | **아침 자동 브리핑만** |
| 판단 위치(아키텍처) | **접근법 A — 코드 결정론 분류**. LLM 환각 차단, 단위 테스트 가능, 강등이라 오분류 저위험 |

## 4. 설계 상세 (How)

### 파트 1 — 완료/대기 판단 (PR 한정)

#### ① GitHub 신호 보강

[octokit-github.client.ts](../../../src/github/infrastructure/octokit-github.client.ts) — 현재 `listMyAssignedTasks`는 PR마다 `pulls.listReviews`만 호출해 `isApproved`만 채운다([:64-70](../../../src/github/infrastructure/octokit-github.client.ts#L64-L70)).

보강 (cron 경로 전용, best-effort):
- **"나(owner)" 식별**: `users.getAuthenticated().login` 1회 조회(프로세스 캐시). 리뷰/코멘트 작성자·PR author 매칭에 사용.
- PR마다 추가 조회:
  - `pulls.get` → `user.login`(author), `requested_reviewers`, `draft`, `mergeable_state`(`clean`/`dirty`/`blocked`/`behind`/`unstable`/`draft`/`unknown` — CI·충돌·필수리뷰를 한 필드로 인코딩).
  - `issues.listComments` → 내 마지막 코멘트 시각 + 그 이후 타인 활동 여부.
  - 기존 `listReviews` 재사용 → 내 최신 리뷰 state/시각, 타인 CHANGES_REQUESTED 여부.
- **신호는 별도 타입** `PullRequestEngagementSignals`(새 파일)로 모은다(기존 `GithubPullRequest` 오염 방지).
- **상한 상수** `ENGAGEMENT_ENRICH_MAX`(코드 상수, 예 15) — 초과분은 보강 없이 ACTIVE + `logger.log`로 캡 명시(silent truncation 금지). (lookback 윈도우 `WAITING_LOOKBACK_HOURS`도 코드 상수 — 기존 컬렉터의 `SLACK_MENTION_SINCE_HOURS` 등과 동일 컨벤션. env 아님.)
- **graceful**: 각 조회 독립 try/catch. 실패 축은 `unknown` → 기본 ACTIVE. 어떤 실패도 plan 흐름을 안 막음.

#### ② 결정론 분류 — 순수 함수

신규 `src/github/domain/classify-pr-engagement.ts` — `classifyPullRequestEngagement(signals): { state: 'ACTIVE' | 'WAITING'; reason: string }`. 부수효과 없는 순수 함수.

판정 규칙 (위에서부터 첫 매치, **기본값 ACTIVE**):

| 조건 | state | 사유(코드 생성) |
|---|---|---|
| `mergeable_state=clean` && `isApproved` | WAITING | "승인·충돌 없음 — 머지만 남음" |
| 내가 CHANGES_REQUESTED 리뷰 | WAITING | "변경 요청함 — 작성자 응답 대기" |
| 최근 48h 내 내가 리뷰/코멘트 + 이후 타인 활동 없음 | WAITING | "검토 남김 — 작성자/리뷰어 응답 대기" |
| `mergeable_state=blocked` && 내가 요청리뷰어 아님 | WAITING | "다른 리뷰어·CI 대기" |
| `mergeable_state=unstable`(CI 실패) && 내가 author 아님 | WAITING | "CI 실패 — 작성자 처리 대기" |
| 내가 요청리뷰어인데 미리뷰 / 신호 unknown / 그 외 | **ACTIVE** | — |

- 보수적: 명확히 "내 차례 아님/내 몫 끝"만 WAITING, 애매하면 ACTIVE. 강등이라 ACTIVE 오분류도 손실 아님.

#### ③ 분리 & 렌더

- **컬렉터**([daily-plan-context.collector.ts](../../../src/agent/pm/application/daily-plan-context.collector.ts)): cron 플래그(현 `excludeApprovedPullRequests` 대체)일 때 PR을 ②로 분류해 ACTIVE/WAITING split. `DailyPlanContext`에 `waitingItems: WaitingItem[]`(repo/number/title/url/reason) 신설. 기존 `excludeApprovedPullRequests` 단순 필터를 이 분류로 **대체**(approved는 드랍이 아니라 "대기 중"으로 강등 — §6).
- **프롬프트 빌더**([daily-plan-prompt.builder.ts](../../../src/agent/pm/application/daily-plan-prompt.builder.ts) → [github-task-formatter.ts](../../../src/agent/pm/domain/prompt/github-task-formatter.ts)): **ACTIVE PR만** GitHub 섹션에 포함 → LLM은 WAITING을 못 봐서 최우선으로 못 올림.
- **usecase**([generate-daily-plan.usecase.ts](../../../src/agent/pm/application/generate-daily-plan.usecase.ts)): 결과(`DailyPlanResult`)에 `waitingItems`를 실어 반환(cron만 채워짐, /today는 빈 배열). pm-agent.type.ts에 필드 추가.
- **렌더**: 신규 `src/slack/format/waiting-section.formatter.ts` → `formatWaitingSection(items): string`(빈 배열이면 빈 문자열). [morning-briefing.autopilot-task.ts](../../../src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts)가 `summaryText`에 plan 렌더 뒤로 이어 붙임(메인 메시지 하단 = 강등).
- **토글**: `BRIEFING_WAITING_SECTION_ENABLED`(boolean, 기본 ON). OFF면 분류·보강 자체를 건너뛰고 기존 `excludeApprovedPullRequests` 동작으로 회귀(롤백 안전).

### 파트 2 — 윤문 (기존 `HumanizeService` 재사용)

신규 모듈/AgentType/env **없음**. #121 자산을 그대로 쓴다.

- **어댑터 함수 추가**: [humanize-report.adapter.ts](../../../src/humanize/application/humanize-report.adapter.ts)에 `humanizeDailyPlan(plan: DailyPlan, humanizer: HumanizeService): Promise<DailyPlan>` 신설. 기존 `humanizeImpactReport`/`humanizeDailyReview`와 동일 패턴(`flattenArray`/`rebuildArray` 사용, `humanizer.humanize(fields)` 1회 호출).
  - 윤문 대상 필드: `reasoning`, `varianceAnalysis.analysisReasoning`, `blocker`(빈 문자열/`null`이면 제외 — `humanize()`가 빈값 키를 자동 스킵).
  - 보존: 모든 `TaskItem`(GitHub/Notion 원문 제목), `estimatedHours`, `lineage`, id/url/source.
- **wiring**: [morning-briefing.autopilot-task.ts](../../../src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts)가 `HumanizeService` 주입 → `const humanizedPlan = await humanizeDailyPlan(outcome.result.plan, this.humanizeService)` → `formatDailyPlan(humanizedPlan) + formatWaitingSection(outcome.result.waitingItems) + formatModelFooter(outcome)`. (`AutopilotModule`은 이미 `HumanizeModule` import → 모듈 변경 불필요.)
  - task 레벨 적용이라 **cron 전용**이 자동 충족. 수동 `/today`(usecase 직접 호출)는 윤문 미적용 — 목표와 일치.
- **토글**: 기존 `HUMANIZE_REPORTS_ENABLED`(기본 ON). `humanize()` 내부가 이미 이 env로 가드 → OFF면 원본 반환. **새 env 불필요.**
- **best-effort**: `humanize()`가 파싱 실패·키 불일치·route throw 시 원본 반환(이미 구현됨). 데일리플랜도 그대로 보호.

> 시스템 프롬프트는 기존 `HUMANIZE_SYSTEM_PROMPT`가 이미 "수치·#PR번호·URL·키 불변, 번역투·기계적 병렬·만연체만 손봄"을 명시 — 데일리플랜에 그대로 적합.

## 5. 데이터 흐름 (cron)

```
morning-briefing.autopilot-task.run()
  └ GenerateDailyPlanUsecase.execute({ triggerType: MORNING_BRIEFING_CRON })
      └ DailyPlanContextCollector.collect()
          └ listMyAssignedTasks → [waiting 토글 ON] PR 신호 보강(pulls.get/listComments/listReviews, best-effort, ≤MAX)
          └ classifyPullRequestEngagement → ACTIVE / WAITING split
          └ context.githubTasks = ACTIVE PR만 ; context.waitingItems = WAITING
      └ promptBuilder.build(context)   ← ACTIVE PR만
      └ route(PM=ChatGPT) → parseDailyPlan → DailyPlan
      └ return { plan, sources, waitingItems }
  └ humanizeDailyPlan(plan, humanizeService)   ← HUMANIZE_REPORTS_ENABLED ON일 때만, 실패 시 원본
  └ summaryText = formatDailyPlan(humanizedPlan) + formatWaitingSection(waitingItems) + formatModelFooter()
```

## 6. 동작 변화 / 리스크

- **동작 변화**: 기존엔 approved PR을 *조용히 드랍*했으나, 이제 "🕓 대기 중"에 *사유와 함께 노출*된다(사용자가 고른 "강등"). 토글 OFF면 기존 드랍.
- 윤문이 cron당 LLM 1회 추가(기존 보고서와 동일 비용 구조) → 지연·비용 소폭, `HUMANIZE_REPORTS_ENABLED`로 제어.
- GitHub 보강이 PR당 +2콜(pulls.get/listComments) → 1일 1회 + 상한 캡 + graceful.
- 윤문 모델의 수치 변형 위험 → 기존 보존 프롬프트 + best-effort 원본 fallback으로 완화(100% 차단 불가 — 기존 한계 그대로).
- 분류 오판 → 보수적 규칙(기본 ACTIVE) + 강등(드랍 아님)으로 손실 차단. 사유 노출로 사후 점검 가능.

## 7. 테스트 전략

- `classify-pr-engagement.spec.ts`(순수 함수): 각 규칙 분기 + 기본 ACTIVE + unknown 신호 → ACTIVE.
- `humanize-report.adapter.spec.ts`에 `humanizeDailyPlan` 케이스 추가: 서술 필드 교체 + TaskItem/수치 보존 + 윤문 실패 시 원본.
- 컬렉터 spec: cron split(ACTIVE만 githubTasks, WAITING은 waitingItems), /today 무변경, 보강 실패 graceful.
- `waiting-section.formatter.spec.ts`: 항목 렌더/빈 배열→빈 문자열/사유 노출.
- `morning-briefing.autopilot-task.spec.ts`: humanize + waiting 섹션 합성, EMPTY_TASKS 안내 유지.
- octokit client spec: 신호 보강 graceful·캡.
- 완료 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 green.

## 8. env / 문서 동기

- **신규 env 1개**: `BRIEFING_WAITING_SECTION_ENABLED`(boolean, 기본 true). 동기 갱신: `.env.example` · `.env` · [app.config.ts](../../../src/config/app.config.ts)(class-validator, optional) · `README` · `docs/env-catalog.md`.
- 윤문은 기존 `HUMANIZE_REPORTS_ENABLED` 재사용 → env 추가 없음.
- `WAITING_LOOKBACK_HOURS` / `ENGAGEMENT_ENRICH_MAX`는 **코드 상수**(env 아님).
- env 추가했으므로 **`pnpm docs:check` 필수**(메모 `feedback_docs_sync_check` — CI verify(sync-docs)가 잡음). AgentType은 추가 안 하므로 agent-registry/agent-catalog 변경 없음.

## 9. 손대는 파일

**신규**
- `src/github/domain/classify-pr-engagement.ts` (+ spec), `src/github/domain/pr-engagement.type.ts`
- `src/slack/format/waiting-section.formatter.ts` (+ spec)

**수정**
- `src/github/infrastructure/octokit-github.client.ts`(신호 보강 + getAuthenticated), `src/github/domain/port/github-client.port.ts`(포트 메서드)
- `src/agent/pm/application/daily-plan-context.collector.ts`(split + waitingItems), `daily-plan-prompt.builder.ts` / `domain/prompt/github-task-formatter.ts`(ACTIVE만)
- `src/agent/pm/application/generate-daily-plan.usecase.ts`(waitingItems 반환), `domain/pm-agent.type.ts`(`DailyPlanResult.waitingItems`, `WaitingItem` 타입)
- `src/humanize/application/humanize-report.adapter.ts`(`humanizeDailyPlan` 추가)
- `src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts`(HumanizeService 주입 + 윤문 + 대기 섹션)
- `src/config/app.config.ts` + `.env.example` + `.env` + `README` + `docs/env-catalog.md`

> `AutopilotModule`은 `HumanizeModule`을 이미 import → **모듈 와이어링 변경 없음**.

## 10. 범위 밖 / 후속

- 이슈(non-PR) 완료/대기 판단.
- 수치/식별자 사후 대조 검증기(윤문 후 토큰 diff 가드).
- 대기 섹션을 메인 메시지 대신 스레드 댓글(`detailText`)로 분리하는 옵션(현재는 summaryText 하단 = 강등).
- 수동 `/today`로 윤문/대기 분류 확장.
