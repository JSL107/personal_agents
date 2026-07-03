# 저녁 회고 → 발행 후보 파이프라인 (EVENING_RETRO_PUBLISH) 설계

- 작성일: 2026-07-03
- 상태: 설계 승인 완료, 구현 중 (worktree feat/evening-retro-publish)
- base: main @ #134 (다건 PR 통합 회고 REFLECT_PR 포함)
- 관련: autopilot evening 그룹, PreviewGate, career-mate(REFLECT_PR 다건), blog

---

## 1. 문제 (Why)

사용자는 "저녁 브리핑에서 오늘 하루 한 일을 회고하고, 괜찮은 작업의 키워드를 잡아
Notion 블로그로 발행하고 이력서/포트폴리오로 정리"하는 자동화를 원했으나 **동작하지 않는다.**

근본 원인은 **버그가 아니라 미구현**이다. 부품은 각각 존재하지만 저녁 브리핑에 연결돼 있지 않다.

- 현재 저녁 브리핑(매일 19:00 KST, `digestGroup: 'evening'`)이 실제 하는 일은 두 가지뿐:
  - `daily-eval` — PO_EVAL 기반 일일 회고 (`po-eval.autopilot-task.ts`)
  - `work-reviewer` — PM plan 기반 퇴근 worklog (`work-reviewer.autopilot-task.ts`)
  - 근거: `src/autopilot/domain/autopilot.playbook.ts:28-50`
- 블로그 발행(`generate-blog-draft.usecase.ts`)·회고→이력서/포트폴리오 반영(`reflect-pr.usecase.ts`)은
  각각 구현돼 있으나 **autopilot 레이어와 미연결**이다.
- 즉, autopilot 레이어에 블로그/career 관련 task가 전무해 저녁에 자동 실행될 진입점이 없다.

## 2. 목표 (What) — 성공 기준

매일 19:00 KST evening 그룹에서, 오늘 한 일을 종합 회고하고 "발행 후보 + 가치 점수"를
Slack으로 제안한다. 발행 여부는 사용자가 Slack 버튼(PreviewGate)으로 결정한다.

성공 기준:
1. 저녁 브리핑에 "🌙 오늘의 회고 + 발행 후보(가치 점수표)"가 본문으로 합류한다.
2. 별개 메시지로 PreviewGate 카드 2장이 발송된다 — `[📝 블로그 발행][❌스킵]`, `[💼 경력 반영][❌스킵]`.
3. `[📝 블로그 발행]` 승인 시 codex로 본문을 생성해 Notion에 발행한다(Hermes 우회).
4. `[💼 경력 반영]` 승인 시 **오늘 머지된 PR 전체**를 다건 통합 회고로 이력서 프로필에 편입하고 포트폴리오를 Notion에 append한다.
5. 소스가 아예 없는 날(오늘 PR·worklog·daily-eval 전무)은 카드도 내지 않고 skip한다.
6. `pnpm lint:check && pnpm test && pnpm build` 3중 green.

## 3. 브레인스토밍 결정 요약

| 축 | 결정 |
|---|---|
| 자동화 수준 | 후보 제안 → **PreviewGate 승인 후 실행** (자동 발행 아님) |
| 회고 소스 | 오늘 머지 PR(GitHub) + WORK_REVIEWER run + PO_EVAL run (3종 종합) |
| 빈 날 처리 | 항상 후보+가치점수 제시, 발행 여부는 버튼. 단 **소스 전무면 skip** |
| 승인 버튼 | **카드 2장 분리** (블로그 / 경력 각각) |
| 블로그 생성 경로 | **codex 직접 생성 + Notion append** (Hermes 우회) |
| task 구조 | **단일 task + PreviewGate 카드 2장** (`previews[]` 필드 확장) |
| 모델 경로 | **신규 AgentType `EVENING_RETRO`** (BLOG는 Hermes 전용 sentinel이라 재사용 불가) |
| 기본 활성 | **기본 ON** (`EVENING_RETRO_PUBLISH_ENABLED !== 'false'`) |
| 경력 반영 | **오늘 머지 PR 전체를 다건 통합 회고**로 반영 (#134 `extractPrReferences` 활용, 결정론적) |

## 4. 아키텍처 / 전체 흐름

```
매일 19:00 KST (evening 그룹, daily-eval·work-reviewer 뒤 순서)
  │
  └─ [신규] EveningRetroPublishTask (riskTier: T1_PREVIEW)
       0. EVENING_RETRO_PUBLISH_ENABLED === 'false' → skip=true
       1. 소스 3종 수집
          · 오늘 머지 PR   ← githubClient.listAuthorMergedPullRequestsSince({ author, sinceIsoDate=오늘, limit })
          · 오늘 worklog   ← agentRunService.findRecentSucceededRuns({ agentType: WORK_REVIEWER, slackUserId, sinceDays:1, limit:1 })
          · 오늘 daily-eval ← agentRunService.findRecentSucceededRuns({ agentType: PO_EVAL, slackUserId, sinceDays:1, limit:1 })
          → 셋 다 비면 skip=true (빈 알림 방지)
       2. codex 1회 호출 (route: agentType=EVENING_RETRO)
          입력: 3소스 종합 텍스트
          출력(JSON): { retrospective, candidates:[{title,keywords[],blogValueScore(0~100),reason}] }
       3. 결과 반환
          · summaryText  → evening 다이제스트 본문 합류 ("🌙 회고 + 후보 점수표")
          · previews[]   → PreviewGate 카드 (orchestrator가 발송)
                ├─ candidates 있으면: EVENING_BLOG_PUBLISH   { topPick, keywords, retroContext }  (대표=최고점 후보)
                └─ mergedPrs 있으면:  EVENING_CAREER_REFLECT { prRefs[] }  (오늘 머지 PR 전체)
       │
  [✅ 블로그 발행] → EveningBlogPublishApplier
        codex(EVENING_RETRO)로 본문 생성 → notionClient.findOrCreateChildPage + appendBlocks
  [✅ 경력 반영]  → EveningCareerReflectApplier
        reflectPr.execute({ slackUserId, prText: prRefs.join('\n') }) → 다건 통합 회고 + 프로필 편입 + renderPortfolio 자동
```

핵심 제약과 대응:
- **task 간 결과 전달 통로 없음**: work-reviewer/daily-eval이 방금 만든 결과를 직접 넘겨받을 수 없어,
  신규 task가 `AgentRunService`로 오늘 run output을 재조회한다(오늘 머지 PR은 GitHub 재조회). Notion을 긁지 않는다.
- **preview 복수화**: orchestrator는 이미 `previews` 배열을 돌며 카드를 발송하므로
  (`autopilot.orchestrator.ts:162-178`), `AutopilotTaskResult`에 `previews?: AutopilotPreviewRequest[]`
  필드만 추가하면 카드 2장이 자연히 나간다. 기존 `preview` 단수는 유지(하위호환).
- **경력 반영은 오늘 머지 PR 전체(결정론적)**: #134의 `extractPrReferences`(다건, shorthand `owner/repo#번호`·URL 파싱)와
  `reflect-pr.usecase`의 다건 통합 회고 분기를 그대로 활용한다. LLM이 대표 PR을 고를 필요 없이
  `prRefs = mergedPrs.map(pr => owner/repo#번호)`를 `prText`로 join해 넘기면 다건 통합 회고가 실행된다.
  오늘 머지 PR이 없으면 경력 카드는 생략(블로그 카드만).

## 5. 컴포넌트 (신규/변경 파일)

### 신규
1. `src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts` — task 본체
2. `src/agent/blog/domain/prompt/evening-retro.prompt.ts` — 회고 후보선별 + 블로그 본문 프롬프트/파서
3. `src/agent/blog/infrastructure/evening-blog-publish.applier.ts` — 블로그 발행 applier
4. `src/agent/career-mate/infrastructure/evening-career-reflect.applier.ts` — 경력 반영 applier(다건 위임)

### 변경 (얇게)
- `src/autopilot/domain/autopilot-task.port.ts` — `AutopilotTaskResult.previews?: AutopilotPreviewRequest[]` 추가
- `src/autopilot/application/autopilot.orchestrator.ts:61-63` — `result.previews`도 push
- `src/preview-gate/domain/preview-action.type.ts` — `PREVIEW_KIND`에 `EVENING_BLOG_PUBLISH`, `EVENING_CAREER_REFLECT`
- `src/model-router/domain/model-router.type.ts` + `.../model-router.usecase.ts` — `AgentType.EVENING_RETRO` + codex 매핑
- `src/autopilot/domain/autopilot.playbook.ts` — evening 그룹 entry(work-reviewer 뒤), cron=`DEFAULT_DAILY_EVAL_CRON`, `T1_PREVIEW`
- `src/autopilot/autopilot.module.ts` — task 등록(import/provider/factory/inject) + GithubModule import
- `src/app.module.ts` — `PreviewGateModule.forRoot` appliers 2개 + imports
- env 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts` + README 표

## 6. 데이터 / 인터페이스 (확인 완료 @ #134)

- `githubClient.listAuthorMergedPullRequestsSince({ repo: string|null, author, sinceIsoDate:'YYYY-MM-DD', limit }): Promise<GithubPullRequestSummary[]>`
  - `GithubPullRequestSummary` = `{ repo, number, title, url, body, mergedAt, additions, deletions, changedFilesCount }`
- `agentRunService.findRecentSucceededRuns({ agentType, slackUserId?, sinceDays, limit }): Promise<{ id, output: unknown, endedAt }[]>`
- `modelRouter.route({ agentType, request: { prompt, systemPrompt? }, noFallback? }): Promise<{ text, modelUsed, provider }>`
- `reflectPr.execute({ slackUserId, prText }): Promise<AgentRunOutcome<ReflectPrResult>>`
  - `ReflectPrInput = { slackUserId: string; prText: string }` (유지됨). 내부 `extractPrReferences(prText)`가 다건 파싱 → 통합/단일 회고 분기. `ReflectPrResult.portfolioUrl` 존재.
- `notionClient.findOrCreateChildPage({ parentPageId, title }): Promise<{ pageId, url, ... }>`, `notionClient.appendBlocks({ pageId, blocks })`

### codex 회고 출력 스키마 (JSON)
```jsonc
{
  "retrospective": "오늘 한 일 회고 요약 (2~4문장)",
  "candidates": [
    { "title": "작업 제목", "keywords": ["kw1","kw2"], "blogValueScore": 0-100, "reason": "가치 근거" }
  ]
}
```
(경력 반영 PR 목록은 LLM이 아니라 task가 `mergedPrs`에서 결정론적으로 구성.)

### PreviewGate payload
- `EVENING_BLOG_PUBLISH`: `{ topPick: { title, keywords[] }, retroContext: string, slackUserId }`
- `EVENING_CAREER_REFLECT`: `{ prRefs: string[], slackUserId }` (예: `["owner/repo#123","owner/repo#124"]`)

## 7. 에러 처리

- **codex JSON 파싱 실패**: orchestrator가 task 실패를 그룹 단위로 격리(`orchestrator.ts:59-80`)하므로
  이 task가 터져도 daily-eval/worklog는 정상 발송. task 내부에서도 파싱 실패 시 안전 fallback(회고 텍스트만, previews 없음).
- **소스 전무**: `skip=true`.
- **오늘 머지 PR 없음**: 경력 카드 생략(블로그 카드만).
- **applier 실패**: PreviewGate가 throw를 사용자에게 노출(기존 동작).
- **게이트 OFF**: `EVENING_RETRO_PUBLISH_ENABLED === 'false'`면 즉시 skip.

## 8. 테스트 전략

- `evening-retro-publish.autopilot-task.spec.ts` — 게이트 OFF/소스 전무 skip, PR 있음→카드 2장, PR 없음+worklog→카드 1장, 파싱 실패 fallback.
- `evening-blog-publish.applier.spec.ts` — NOTION_PAGE_ID 미설정 throw, 정상 시 route→findOrCreateChildPage→appendBlocks.
- `evening-career-reflect.applier.spec.ts` — prRefs join 위임, prRefs 빈 배열 throw.
- `evening-retro.prompt.spec.ts` — 파서(코드펜스/빈 candidates/파싱실패).
- orchestrator: `previews[]` 펼침 회귀.

## 9. 환경 변수 (신규)

| env | 타입 | 기본 | 용도 |
|---|---|---|---|
| `EVENING_RETRO_PUBLISH_ENABLED` | string('true'/'false') | 미설정=ON (`!== 'false'`) | 저녁 회고→발행 기능 ON/OFF |
| `EVENING_RETRO_BLOG_NOTION_PAGE_ID` | string(optional) | — | 블로그 발행 대상 Notion 부모 페이지(미설정 시 블로그 카드 승인은 명시 에러) |

- 오늘 머지 PR author는 기존 `IMPACT_REPORT_GITHUB_AUTHOR` 재사용.
- 경력 반영은 기존 `CAREER_PORTFOLIO_NOTION_PAGE_ID` 재사용(reflect-pr 내부).

## 10. 범위 밖 / 후속

- 블로그 "역방향"(블로그 글 → 이력서 반영) 파이프라인.
- 이력서를 Notion에 직접 렌더링(현재 render-resume는 DB 조회만).
- `/retry-run` switch·`ResponseCode` enum 등 AGENTS.md §4 항목은 이 기능이 슬래시 없는 autopilot 전용이라 N/A(문서에 명시).
