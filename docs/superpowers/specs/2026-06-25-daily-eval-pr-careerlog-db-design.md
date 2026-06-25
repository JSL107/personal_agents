# Daily Eval — 오늘 머지 PR 평가 + careerLog Notion DB 자동 적재

- 작성일: 2026-06-25
- 상태: 설계 승인 (사용자 위임 "PR 올릴거면 알아서 ㄱㄱ")
- 브랜치: `feat/daily-eval-pr-careerlog-db`

## 1. 문제 (Why)

매일 19:00 KST 자동 `Daily Eval` 회고([po-eval.autopilot-task.ts](../../../src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts))는 두 가지 한계가 있다.

1. **오늘 머지된 PR을 평가하지 않는다.** Daily Eval 입력은 3개 sub-agent run snapshot
   (WORK_REVIEWER / PO_SHADOW / IMPACT_REPORTER) 뿐이다
   ([generate-po-evaluation.usecase.ts:114-138](../../../src/agent/po-eval/application/generate-po-evaluation.usecase.ts#L114-L138)).
   실제 회고 메시지의 `합성 source: workReviewer=#18 · missing: poShadow, impactReporter` 가
   그 증거 — PR은 평가 근거에 없다.

2. **careerLog(이력서 소스)가 휘발된다.** Daily Eval은 careerLog를 Slack 텍스트로만 출력하고 끝낸다
   ([po-eval.autopilot-task.ts:36-41](../../../src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts#L36-L41)).
   Notion 적재기([po-eval-careerlog.applier.ts](../../../src/agent/po-eval/infrastructure/po-eval-careerlog.applier.ts))는
   존재하지만 수동 `/po-eval` 의 ✅ 버튼(PreviewGate) 경로에만 연결돼 있고
   ([phase-command.handler.ts:98-125](../../../src/slack/handler/phase-command.handler.ts#L98-L125)),
   cron 경로에는 연결돼 있지 않다.

영향: 매일 생성되는 정성·정량 성과 평가가 이력서 작성 시점에 재사용 가능한 형태로 남지 않는다.

## 2. 목표 (What)

Daily Eval(cron)이:
- **오늘 머지된 본인 PR을 근거로 평가**하고(LLM 합성 입력에 PR 추가),
- 그 결과를 **하루 1행으로 Notion Database에 자동 upsert**한다(이력서 작성 시 필터·정렬·검색 가능한 소스).

성공 기준:
- 19:00 회고 Slack 메시지에 "오늘 머지 PR 평가" 섹션이 추가된다(PR이 있을 때).
- 같은 날짜의 Notion DB 행 1개에 정량/정성/기술/Impact/머지PR/PR평가/source가 채워지고,
  cron 재실행 시 중복 행이 아니라 덮어쓰기(upsert)된다.
- env 미설정(DB ID 부재)이거나 PR 0건이거나 Notion 실패여도 **회고 Slack 자체는 그대로 발송**된다.

## 3. 범위

### 이번 작업
- Daily Eval(cron, range=TODAY) 경로 한정: 오늘 머지 PR 합성 + careerLog DB upsert.

### 범위 밖 (후속)
- 수동 `/po-eval` 의 DB 통일 — 현행 ✅ 버튼 페이지(`CAREER_LOG_NOTION_PAGE_ID`) 경로 그대로 유지.
- `pr-careerlog`(webhook PR 머지 → 페이지 메타 적재) — **수정하지 않는다**(레거시 경계 존중).
  새 DB는 별도 env(`CAREER_LOG_NOTION_DB_ID`)로 분리해 충돌을 피한다.
- career-mate(`CareerProfile` PR 합성) 통합 — 향후 이 DB를 입력 소스로 삼을 수 있으나 이번엔 안 함.
- careerLog `schemaVersion` 승격(1→2) — 하지 않는다. PR 평가는 careerLog 밖 별도 필드로 둔다.

## 4. 아키텍처 / 데이터 흐름

```
19:00 cron → AutopilotOrchestrator.runGroup (변경 없음)
                 └─ PoEvalAutopilotTask.run()                       [변경]
                      ├─ GeneratePoEvaluationUsecase.execute(range=TODAY)   [변경]
                      │     ├─ collectSnapshots (3 sub-agent, 기존)
                      │     ├─ [신규] range=TODAY → GithubClientPort
                      │     │        .listAuthorMergedPullRequestsSince(author, since=오늘KST, limit)
                      │     ├─ buildPrompt(+ 오늘 머지 PR 섹션)              [변경]
                      │     ├─ LLM 1회 합성 → { qualitative, careerLog, mergedPrReview? }
                      │     └─ EvaluationOutput (mergedPrReview join 메타)
                      ├─ formatEvaluationOutput + PR 평가 섹션 → slackText  [변경]
                      └─ [신규, try/catch 격리] CareerLogDbApplier.upsert(
                             dbId, period, EvaluationOutput, modelUsed, runId)
                             └─ NotionClientPort.findOrCreateDailyPage({databaseId, title=period})
                                  + updatePageProperties({pageId, properties})  [둘 다 기존 메서드]
```

핵심 원칙:
- **부작용(DB 적재)은 task 내부**에서 수행한다. Orchestrator는 `slackText` 만 수집하므로
  ([autopilot.orchestrator.ts:52-67](../../../src/autopilot/application/autopilot.orchestrator.ts#L52-L67)) Orchestrator는 변경하지 않는다.
- DB 적재는 **try/catch로 감싸 실패해도 throw하지 않는다** — Orchestrator의 task 실패 격리는
  회고 텍스트를 "⚠️ 실패" 한 줄로 대체해버리므로, 적재 실패가 회고를 가리면 안 된다.
  적재 실패는 logger.warn + (선택) slackText 말미 한 줄 주석.

## 5. 컴포넌트별 설계

### 5.1 PR 수집 — 기존 메서드 재사용 (신규 코드 없음)
`GithubClientPort.listAuthorMergedPullRequestsSince({ repo, author, sinceIsoDate, limit })`
→ `GithubPullRequestSummary[]`(number/title/body/url/additions/deletions/changedFilesCount/mergedAt).
impact-reporter가 이미 사용하는 검증된 경로.
- `author` = `IMPACT_REPORT_GITHUB_AUTHOR`(필수), `repo` = `IMPACT_REPORT_GITHUB_REPO`(선택, null이면 전 repo).
- `sinceIsoDate` = **KST 오늘 0시 날짜**(`getTodayKstDate()`).
  주의: GitHub `merged:>=` 는 UTC 기준일 수 있어 경계에서 어제/내일 PR이 섞일 수 있다 →
  usecase에서 `mergedAt` 의 KST 날짜 == 오늘인 것만 2차 필터.
- `GeneratePoEvaluationUsecase` 가 `GithubClientPort` 를 주입받는다(현재 미주입).
  `IMPACT_REPORT_GITHUB_AUTHOR` 미설정 시 PR 수집 skip(회고는 sub-agent만으로 진행).

### 5.2 LLM 출력 확장 — `mergedPrReview`
careerLog 구조(schemaVersion=1)는 **변경하지 않는다**. PR 평가는 LLM 출력의 별도 top-level 필드로 추가:

```jsonc
{
  "qualitative": { ... },   // 기존
  "careerLog":   { ... },   // 기존 (schemaVersion 1 유지)
  "mergedPrReview": {       // 신규 — 입력에 PR 있을 때만. 없으면 생략/null
    "overall": "오늘 머지 PR 전반 평가 1~2문장",
    "prs": [ { "prNumber": 110, "evaluation": "이 PR의 난이도·기술적 의미·임팩트 1~2문장" } ]
  }
}
```

- LLM은 **평가 텍스트만** 생성한다(`prNumber` + `evaluation`).
  ref/title/url/stat 같은 메타는 usecase가 `GithubPullRequestSummary` 에서 `prNumber` 로 join —
  LLM 환각 메타 방지.
- 변경 파일:
  - [po-eval-system.prompt.ts](../../../src/agent/po-eval/domain/prompt/po-eval-system.prompt.ts):
    출력 schema에 `mergedPrReview`(optional) 추가 + "입력 PR이 없으면 생략" 규칙 + "입력에 없는 PR 추정 금지".
  - [evaluation.parser.ts](../../../src/agent/po-eval/domain/prompt/evaluation.parser.ts):
    `parseMergedPrReview`(optional, 누락 시 undefined). `EvaluationLlmOutput` 에 `mergedPrReview?` 추가.
  - [po-eval.type.ts](../../../src/agent/po-eval/domain/po-eval.type.ts):
    `EvaluationOutput.mergedPrReview?: { overall: string; prs: { prNumber; ref; title; url; additions; deletions; evaluation }[] }`.
  - [generate-po-evaluation.usecase.ts](../../../src/agent/po-eval/application/generate-po-evaluation.usecase.ts):
    PR 수집 → prompt 주입 → LLM `prNumber`별 evaluation을 PR 메타와 join → `mergedPrReview` 채움.

### 5.3 Slack 포맷 — PR 평가 섹션
[po-evaluation.formatter.ts](../../../src/slack/format/po-evaluation.formatter.ts) 에
`mergedPrReview` 가 있으면 회고 메시지에 섹션 추가:
```
🔀 오늘 머지 PR 평가
• #110 docs(tistory-blog) — <평가 한 줄>
(overall 한 단락)
```
없으면(undefined) 섹션 생략 — 기존 출력과 동일.

### 5.4 careerLog DB Applier (신규)
`src/agent/po-eval/infrastructure/career-log-db.applier.ts` (신규):
- `upsert({ databaseId, period, output, modelLabel, runId })`:
  1. `notionClient.findOrCreateDailyPage({ databaseId, title: period })` → row pageId
     (title 속성 = period. `/today` 가 쓰는 검증된 메서드).
  2. `buildCareerLogDbProperties(output, modelLabel, runId)` → Notion properties payload.
  3. `notionClient.updatePageProperties({ pageId, properties })`.
- `buildCareerLogDbProperties`: [blog-publish-properties.ts](../../../src/agent/blog/domain/blog-publish-properties.ts)
  의 properties 빌더 패턴을 따른다(rich_text / multi_select / date 등 Notion payload 직접 구성).
- **새 NotionClientPort 메서드는 추가하지 않는다** — `findOrCreateDailyPage` + `updatePageProperties` 조합으로 충분.

### 5.5 Notion DB 스키마 (하루 1행, title=날짜가 upsert 키)
| 속성 | 타입 | 내용 |
|---|---|---|
| `Date` | title | `2026-06-24` (period) — upsert 매칭 키 |
| `정량 성과` | rich_text | careerLog.achievements.quantitative join `\n` |
| `정성 성과` | rich_text | careerLog.achievements.qualitative join `\n` |
| `기술 스택` | multi_select | careerLog.technologies |
| `Impact` | rich_text | careerLog.impact |
| `Wins` | rich_text | qualitative.wins join `\n` |
| `Blockers` | rich_text | qualitative.blockers join `\n` |
| `머지 PR` | rich_text | `#110 title (url)` join `\n` (mergedPrReview.prs 메타) |
| `PR 평가` | rich_text | overall + PR별 evaluation |
| `Source` | rich_text | `workReviewer=#18 · missing: …` |
| `Model/Run` | rich_text | `claude-cli · run #22` |

DB는 **사전 생성** 후 ID를 env에 주입(코드가 DB를 자동 생성하지 않음 — 권한·위치 안전).
실제 DB 생성은 구현 완료 후 Notion MCP로 수행(사용자 워크스페이스의 부모 페이지 하위).

### 5.6 env (4곳 동기 — CLAUDE.md §2 #7)
신규 `CAREER_LOG_NOTION_DB_ID?`(선택):
- `.env.example` + `.env` + [app.config.ts](../../../src/config/app.config.ts)(class-validator, optional string) + README 표.
- 미설정 시 DB 적재 skip(회고는 그대로). 재사용 env: `IMPACT_REPORT_GITHUB_AUTHOR`, `IMPACT_REPORT_GITHUB_REPO`.

## 6. 동작 변화 / 리스크
- 배포 시 19:00 회고에 PR 평가 섹션 추가 + (DB ID 설정 시) Notion DB 행 자동 생성/갱신.
- `CAREER_LOG_NOTION_DB_ID` 미설정이면 동작 변화 없음(적재 skip).
- GitHub 조회 추가 1회/일 — quota 영향 미미(impact-reporter와 동일 메서드).
- 호환성: careerLog schemaVersion 유지 → 수동 `/po-eval` 페이지 경로·기존 row 무영향.
- break-point 후보: GitHub author env 오설정 시 PR 0건(회고는 정상). KST/UTC 날짜 경계(§5.1 2차 필터로 완화).

## 7. 검증
- `generate-po-evaluation.usecase.spec`: range=TODAY PR 수집 주입 / PR 0건 / author env 미설정 분기 / mergedPrReview join.
- `evaluation.parser.spec`: mergedPrReview 파싱(있음/없음/부분).
- `career-log-db.applier.spec`(신규): findOrCreateDailyPage→updatePageProperties 호출, properties payload 형태, period 0건/빈 필드.
- `po-eval.autopilot-task.spec`: DB applier 호출 검증 + 적재 실패 시 slackText 보존(throw 안 함).
- `po-evaluation.formatter.spec`: PR 평가 섹션 렌더 / 없을 때 생략.
- 완료 기준: `pnpm lint:check && pnpm test && pnpm build` 3중 green (CLAUDE.md §2 #2).

## 8. 미해결/구현 시 확인
- `findOrCreateDailyPage` 의 title 매칭이 DB title 속성을 정확히 query하는지 —
  [notion-api.client.ts](../../../src/notion/infrastructure/notion-api.client.ts) 구현 확인 후 적용.
- `mergedPrReview.prs` 의 `prNumber` ↔ `GithubPullRequestSummary.number` join 시 LLM이 일부 PR을 누락/추가하는 경우:
  usecase는 GithubPullRequestSummary를 source-of-truth로, evaluation 없는 PR은 메타만, LLM이 만든 미존재 prNumber는 버린다.
