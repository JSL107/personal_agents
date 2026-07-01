# CAREER_MATE `REFLECT_PR` — 단일 PR 회고 → 이력서/포트폴리오 반영

- 작성일: 2026-07-01
- 상태: 설계 확정 (사용자 승인 완료)
- 대상 레포: `personal_agents` (이대리)
- 브랜치: `worktree-feat+career-mate-reflect-pr`

---

## 1. 배경 / 문제 (Why)

`@이대리 <PR URL> 이 PR 회고해서 이력서·포트폴리오에 녹여줘` 요청이 **PO_EVAL(주간 통합 평가)** 로 오분류되어, 특정 PR이 아니라 최근 7일 전체 PR을 종합한 careerLog가 나왔다.

근거:
- `PO_EVAL`은 단일 PR 입력 경로가 없다 — `EvaluationInput`에 PR 필드 없음 (`src/agent/po-eval/domain/po-eval.type.ts:4-10`), 디스패처가 `range`를 안 넘겨 항상 `WEEK`(7일) 고정 (`src/agent/po-eval/infrastructure/po-eval.dispatcher.ts:26-34`). `slackUserId`로 최근 7일 sub-agent run을 DB에서 합성할 뿐 PR diff는 읽지 않는다 (`generate-po-evaluation.usecase.ts:121,184-219`).
- 1차 IntentClassifier 프롬프트가 PO_EVAL 예시로 `"회고 + 이력서용으로 정리"`를 명시 (`src/router/domain/prompt/intent-classifier-system.prompt.ts:15`) → "회고 + 이력서/포폴" 조합이 여기로 흡수. PR URL 범위는 무시됨.
- 정작 적합한 `CAREER_MATE`는 main에 병합돼 있으나(#90/#91/#92), 단일 PR 입력 액션이 없고 `BUILD_PROFILE`은 최근 N개월 merged PR **100건 일괄**만 지원 (`build-career-profile.usecase.ts:35`).

즉 "이 PR 하나를 깊게 회고 → 이력서/포폴 반영" 경로 자체가 부재하다.

## 2. 목표 / 성공 기준 (What)

`CAREER_MATE`에 신규 액션 `REFLECT_PR`을 추가한다.

- 특정 PR **하나**를 실제로 읽고(본문·diff·메타), 그 PR **단독** 회고를 생성한다 (주간 통합 아님).
- 산출물 3종을 한 번에 생성·반영한다:
  1. **회고 서술** — 문제/의사결정/트레이드오프/배운 점 (Slack 응답).
  2. **이력서 accomplishment** — STAR + bullet + techTags + evidence. 최신 역량 프로필에 **편입 저장**.
  3. **Notion 포트폴리오 항목** — 포폴 페이지에 append.
- 라우팅이 이 요청을 PO_EVAL이 아니라 `CAREER_MATE.REFLECT_PR`로 보낸다.

성공 판정: 실제 PR(예: `schoolbell-e/sbe-workspace#1692`)을 대상으로 실행 시, 그 PR 단독 회고 + 이력서 bullet + 포폴 링크가 나오고, `pnpm lint:check && pnpm test && pnpm build` 3중 green.

## 3. 비목표 (Scope 밖)

- 여러 PR 묶음 회고(프로젝트=N PR). 이번엔 단일 PR만. (확장 여지만 남김.)
- 포트폴리오 replace 시맨틱 (기존과 동일하게 append-only).
- CODE_REVIEWER의 자연어 PR ref 추출 개선 (별도 이슈, 우리 유틸은 career-mate 도메인 내 신설).
- reject-signal 학습, 프로필 diff UI 등.

## 4. 사용자 시나리오

```
@이대리 https://github.com/schoolbell-e/sbe-workspace/pull/1692
이 PR 프로젝트 회고하고 이력서·포트폴리오에 녹여줘
```
→ 1차 분류 `CAREER_MATE` → 2차 분류 `REFLECT_PR` → PR fetch → 회고 합성 → 프로필 편입 → 윤문 → 저장 → 포폴 append → Slack 응답(회고 서술 + 이력서 bullet + 포폴 링크).

## 5. 라우팅 변경

### 5.1 1차 IntentClassifier (`intent-classifier-system.prompt.ts`)
- **PO_EVAL 예시 축소**: `"회고 + 이력서용으로 정리"` → `"이번 주 통합 정리"` 로 좁혀 주간 롤업 정체성 명확화. ("이번 주 정리해줘", "/po-eval 같은 의미" 유지.)
- **CAREER_MATE 확장**: 기존 예시에 `"이 PR 회고해서 이력서/포트폴리오에 녹여줘"` (+ PR URL 동반) 추가.
- **CODE_REVIEWER vs CAREER_MATE 구분 규칙 명시**: PR URL이 있어도 — 동사가 "리뷰/봐줘/피드백"이면 CODE_REVIEWER, "회고/이력서/포트폴리오/녹여/정리"면 CAREER_MATE.

### 5.2 2차 career-mate-intent (`career-mate-intent.prompt.ts`)
- `action` 목록에 `REFLECT_PR` 추가: `"이 PR 회고", "이 PR 이력서에 녹여줘", "이 작업 회고해서 성과로"` (PR URL/shorthand 동반).
- `VALID_ACTIONS` 배열에 `'REFLECT_PR'` 추가.
- **prRef는 2차 프롬프트에서 추출하지 않는다** — LLM 전사 오류 방지 위해 dispatcher가 `input.text`에서 결정론 파싱.

## 6. 신규 `ReflectPrUsecase`

경로: `src/agent/career-mate/application/reflect-pr.usecase.ts`

### 6.1 입력
```ts
interface ReflectPrInput {
  slackUserId: string;
  prRef: string; // dispatcher가 input.text에서 추출·정규화("owner/repo#number")해 전달
}
```

### 6.2 처리 흐름
> PR ref 파싱 책임: **dispatcher가 `extractPrReference(input.text)`로 추출**해 정규화 문자열(`owner/repo#number`)을 usecase의 `prRef`로 넘긴다. usecase는 넘어온 `prRef`를 `parsePrReference`로 `{repo, number}` 검증만 한다(문장 추출 로직 중복 없음). 미검출은 dispatcher 단계에서 예외.

1. **ref 검증**: `parsePrReference(prRef)` → `{repo, number}`. (정규화 형식이므로 실패는 사실상 없음, 방어적 예외 유지.)
2. **fetch**: `githubClient.getPullRequest(ref)` + `getPullRequestDiff(ref)` 병렬 (code-reviewer와 동일 패턴).
3. **회고 합성**: `modelRouter.route({ agentType: CAREER_MATE, prompt: buildPrRetroPrompt({detail, diff}), systemPrompt: PR_RETRO_SYNTH_SYSTEM_PROMPT })` → `parsePrRetroOutput` → `{ accomplishment: ProfileAccomplishment, narrative: string }`.
4. **프로필 편입** (§7):
   - `repository.findLatestBySlackUser(slackUserId)`.
   - 있으면: `accomplishments`에 신규 항목 append. **dedup 키 = evidence의 `repo`+`pr`**. 이미 있으면 교체(최신 회고로 갱신).
   - 없으면: 이 PR 하나로 **최소 프로필** 생성(`summary`는 PR 회고 요약, `skills`는 techTags 기반 최소 구성, `meta.prCount=1`).
5. **윤문**: 편입으로 완성된 `CareerProfileData`에 기존 `humanizeCareerProfile(data, this.humanizer)`를 그대로 재사용 (build-career-profile과 동일 진입점) — best-effort, 비활성/실패 시 원본 유지(회귀 0). 별도 경량 humanize 함수는 만들지 않는다(YAGNI). `narrative`(회고 서술)는 LLM이 이미 자연어로 생성하므로 윤문 대상에서 제외.
6. **저장**: `repository.save(...)` — 윤문 반영된 새 스냅샷.
7. **포폴 append**: `RenderPortfolioUsecase` 재사용 또는 동일 경로로 `notionClient.findOrCreateChildPage` + `appendBlocks(buildPortfolioBlocks(...))`. PreviewGate 없이 바로 append (기존 RENDER_PORTFOLIO 일관).
8. **agentRun**: 전체를 `agentRunService.execute({ agentType: CAREER_MATE, triggerType: SLACK_MENTION_CAREER_MATE, inputSnapshot: {slackUserId, prRef, repo, number}, run })` 로 감싼다.

### 6.3 출력
```ts
interface ReflectPrResult {
  accomplishment: ProfileAccomplishment;
  narrative: string;
  portfolioUrl: string;
  agentRunId: number;
  modelUsed: string;
}
```

## 7. 데이터 모델

- **신규 스키마 변경 없음**. 기존 `CareerProfileData.accomplishments: ProfileAccomplishment[]`에 편입.
- `ProfileAccomplishment`는 이미 `star:{situation,task,action,result}` + `bullet` + `techTags` + `evidence[{repo,pr,url,mergedAt}]` 구조 → 단일 PR 회고를 손실 없이 담는다.
- dedup: `evidence[0].repo === ref.repo && evidence[0].pr === ref.number`.
- 저장은 `CareerProfilePrismaRepository.save` (기존). 프로필 스냅샷이 매 회고마다 새 버전으로 갱신되는 부작용은 의도된 동작(프로필 편입 선택).

## 8. 신규 프롬프트

경로: `src/agent/career-mate/domain/prompt/pr-retro-synth.prompt.ts`
- `PR_RETRO_SYNTH_SYSTEM_PROMPT`: 단일 PR을 STAR 회고로 변환하는 지침. 수치·고유명사·파일경로 보존, 과장 금지, evidence는 입력 PR로 고정.
- `buildPrRetroPrompt({detail, diff})`: `buildReviewPrompt`(code-reviewer)와 유사하게 PR 메타/본문/diff를 조립. diff truncation 노트 포함.
- `parsePrRetroOutput(text)`: JSON 파싱(코드펜스 스트립) → `{accomplishment, narrative}`. 파싱 실패 시 예외.
- 각 함수 `.spec.ts` 동반.

## 9. Formatter (`career-mate.formatter.ts`)
- 신규 `formatPrRetro(result)`: Slack mrkdwn — 회고 서술 + 이력서 bullet(STAR 요약) + 포폴 링크. 기존 `formatProfileSummary`/`formatResume` 스타일 일관.
- LLM 텍스트 mrkdwn escape 기존 헬퍼 준수.

## 10. Dispatcher 변경 (`career-mate.dispatcher.ts`)
- `switch (intent.action)`에 `case 'REFLECT_PR'` 추가:
  - `const prRef = extractPrReference(input.text ?? '')` (미검출 시 예외).
  - `const result = await this.reflectPr.execute({ slackUserId, prRef })`.
  - `return this.toOutcome(result.agentRunId, result, result.modelUsed, formatPrRetro(result))`.
- 생성자에 `ReflectPrUsecase` 주입.

## 11. 모듈 (`career-mate.module.ts`)
- `providers`/`exports`에 `ReflectPrUsecase` 추가.
- 신규 import 모듈 없음 — Github/Notion/Humanize/ModelRouter/AgentRun 이미 등록.

## 12. 재사용 vs 신규 파일 요약

| 구분 | 항목 |
|---|---|
| 재사용 | `getPullRequest`/`getPullRequestDiff`, `ProfileAccomplishment`, `CareerProfileRepository`, `RenderPortfolio`/`buildPortfolioBlocks`, `HumanizeService`, `AgentRunService`, `SLACK_MENTION_CAREER_MATE` |
| 신규 | `reflect-pr.usecase.ts`(+spec), `pr-retro-synth.prompt.ts`(+spec), `extract-pr-reference.ts` 유틸(+spec), `formatPrRetro`, 타입 `REFLECT_PR` |
| 수정 | `career-mate.type.ts`(action), `career-mate-intent.prompt.ts`(2차), `intent-classifier-system.prompt.ts`(1차), `career-mate.dispatcher.ts`, `career-mate.module.ts`, `career-mate.formatter.ts` |
| 불필요 | 신규 슬래시 커맨드, AgentType enum(재사용), AGENT_TO_PROVIDER(재사용), DB 스키마 변경 |

## 13. 리스크 / 엣지케이스

- **PR ref 미검출**: 문장에 PR URL/shorthand 없음 → 명확한 안내 예외.
- **PR 접근 권한/404**: 다른 org PR — GitHub PAT scope 의존. getPullRequest 예외를 usecase가 잡아 사용자 친화 메시지로.
- **diff 초대형**: `getPullRequestDiff` maxBytes truncation — 프롬프트에 truncation 노트(code-reviewer와 동일).
- **프로필 없음**: 최소 프로필 생성 경로.
- **동일 PR 재회고**: dedup으로 교체(중복 누적 방지). 단 포폴은 append-only라 중복 항목 생길 수 있음 → 회고 서술에 회차 표기 or Phase 2 replace로 처리(이번엔 append 허용, 로그로 남김).
- **humanize 실패**: best-effort, 원본 유지(회귀 0).

## 14. 검증 계획

- 단위: `reflect-pr.usecase.spec.ts` (mock github/notion/repo/modelRouter로 fetch→합성→dedup 편입→포폴 append 흐름), 프롬프트 parser spec, `extract-pr-reference.spec.ts` (URL/shorthand/문장-내/미검출).
- 라우팅: 1차/2차 프롬프트 spec에 "PR+회고+이력서" → CAREER_MATE/REFLECT_PR, "PR 리뷰해줘" → CODE_REVIEWER 유지 케이스.
- 게이트: `pnpm lint:check && pnpm test && pnpm build` 3중 green.
- E2E(수동): `sbe-workspace#1692`로 실제 실행 — 사용자 터미널.

## 15. AGENTS.md §4 체크리스트 적용 여부
- 신규 **에이전트가 아니라 기존 CAREER_MATE 내부 액션**이므로 13개 중 다수 해당 없음.
- 해당: (a) 2차 intent action 등록, (b) formatter, (c) dispatcher case, (d) 모듈 provider, (e) 테스트. `AGENT_TO_PROVIDER`/`/retry-run`/`ResponseCode`/슬래시는 CAREER_MATE 기존 등록 그대로 흡수.

## 16. 구현 순서 (개요 — 상세는 writing-plans에서)
1. 타입/유틸(`REFLECT_PR`, `extractPrReference`) + spec.
2. 프롬프트(`pr-retro-synth`) + parser + spec.
3. `ReflectPrUsecase` + spec.
4. formatter + dispatcher + module.
5. 라우팅 프롬프트(1차/2차) 수정 + spec.
6. 3중 green + 실 PR E2E.
