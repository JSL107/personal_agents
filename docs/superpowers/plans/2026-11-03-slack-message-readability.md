# 이대리 메시지 개편 1단계 (문장과 구성) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 아침·저녁 한 통, 승인 카드, 장애 알림, PR 리뷰, 콘솔 보고의 문장을 짧고 쉬운 한국어로 바꾸고, 그 규칙을 테스트와 프롬프트로 고정한다. 새 할 일 저장소 없이 한다.

**Architecture:** 메시지를 만드는 위치는 지금 그대로 둔다. 바꾸는 것은 세 가지다.
- formatter와 task가 만드는 문자열
- LLM 시스템 프롬프트에 공통 글쓰기 규칙을 더하는 것
- `internal-terms.jest-setup.ts` 검사기에 가독성 규칙을 더하는 것. 처음에는 손댄 파일에만 걸고, 마지막 task에서 전체로 넓힌다.

**Tech Stack:** NestJS 11, TypeScript, Jest, Prisma 6, Slack Bolt(mrkdwn, Block Kit). pnpm@9.15.9.

**Spec:** `docs/superpowers/specs/2026-11-03-slack-message-readability-design.md` (2026-11-03 승인). 2단계(할 일 추적)와 3단계(주간 일 점검)는 1단계를 머지한 뒤 별도 계획으로 쓴다.

## Global Constraints

- 사람에게 보이는 문자열에 줄표 `—`(U+2014)를 쓰지 않는다. 코드 블록, 인라인 코드, URL은 예외다.
- PR·이슈를 글자 없이 `#번호`만으로 부르지 않는다. `이름(#123)`과 `<url|이름>`은 허용한다.
- 내부 식별자(`run #N`, 모델 이름 `codex-cli`, `schemaVersion`, enum 값, 환경변수 이름)를 본문에 쓰지 않는다. "AI에 맡기기" 코드 블록은 예외다.
- 영어 라벨(`Daily Eval`, `Wins`, `Blockers`, `Work Reviewer`, `Headline`, `Before`, `After`, `careerLog`)을 쓰지 않는다.
- 오류 원문은 본문에 붙이지 않는다. 스레드의 "AI에 맡기기" 블록에만 넣고 `redactPii`를 거친다.
- task id, 묶음(group) 이름, `AgentType`, Prisma 테이블은 바꾸거나 지우지 않는다. 스키마는 추가만 한다.
- 완료 게이트: `pnpm lint:check && pnpm test && pnpm build`, `node --env-file=.env scripts/check-di.cjs`, `pnpm check:env && pnpm docs:check && pnpm check:invariants && pnpm test:e2e`가 모두 exit 0이어야 한다. worktree에는 `.env`가 없으므로 메인 트리에서 복사해 둔다.
- 커밋은 사용자가 요청할 때만 한다. 아래 Commit 단계는 요청을 받은 뒤 실행한다.

## Review Focus

1. **PM 계획 생성이 실패하거나 할 일이 0개인 날.** "오늘 할 일" 칸에 실패 안내 한 줄 또는 "오늘 자동 수집된 할 일이 없어요"가 나오고, 나머지 칸은 그대로 나가야 한다. 테스트는 Task 2가 맡는다.
2. **오류 원문에 토큰, `user:pass@` URL, 백틱 세 개가 섞인 장애.** 스레드 블록에서 값이 가려지고 코드 블록이 깨지지 않아야 한다. 테스트는 Task 6이 맡는다.
3. **줄표로 문자열을 잘라 읽는 생산자와 소비자 쌍.** `portfolio-publish`가 만들고 `morning-briefing.autopilot-task.ts:232`, `:250`이 읽는다. 줄표를 걷어도 사유가 섞이지 않아야 한다. 테스트는 Task 9가 맡는다.
4. **모델이 영어 라벨이나 줄표를 그대로 쓴 출력.** 테스트로는 못 잡는다. 프롬프트 규칙(Task 8)과 첫 실발송 확인으로 본다.
5. **승인 카드에 짧은 문장(`slackText`)이 없는 옛 행.** `previewText`로 폴백해 카드가 지금처럼 나가야 한다. 테스트는 Task 5가 맡는다.

---

### Task 1: 가독성 검사기

**Files:**
- Create: `src/slack/format/readability-rules.ts`
- Create: `src/slack/format/readability-rules.spec.ts`
- Modify: `src/slack/format/internal-terms.jest-setup.ts` (감싼 결과에 가독성 검사 추가)

**Interfaces:**
- Produces:
  - `findReadabilityViolations(text: string): string[]`
  - `READABILITY_ENFORCED_SOURCES: ReadonlySet<string>`: `src/` 기준 상대경로 목록. 이 목록에 든 파일만 검사한다. Task 2~7이 자기 파일을 더하고, Task 9가 전체 검사로 바꾼다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
describe('findReadabilityViolations', () => {
  it('본문 줄표를 잡는다', () => {
    expect(findReadabilityViolations('PO 검토 — 계획')).toEqual(['—']);
  });
  it('코드 블록·인라인 코드·URL 안의 줄표는 넘긴다', () => {
    expect(findReadabilityViolations('```a — b```')).toEqual([]);
    expect(findReadabilityViolations('`a — b`')).toEqual([]);
  });
  it('글자 없는 #번호를 잡는다', () => {
    expect(findReadabilityViolations('#4746·#1520 검증')).toEqual(['#4746', '#1520']);
    expect(findReadabilityViolations('<https://x/pull/1|#1520>')).toEqual(['#1520']);
  });
  it('이름 뒤 번호와 이름 링크는 허용한다', () => {
    expect(findReadabilityViolations('첨부 오류(#4746)')).toEqual([]);
    expect(findReadabilityViolations('<https://x/pull/1|첨부 오류 고치기>')).toEqual([]);
  });
  it('영어 라벨과 모델 푸터를 잡는다', () => {
    expect(findReadabilityViolations('*Daily Eval* Wins 3')).toEqual(['Daily Eval', 'Wins']);
    expect(findReadabilityViolations('_model: codex-cli · run #11198_')).toEqual(['run #11198', 'codex-cli']);
  });
});
```

- [ ] **Step 2:** `pnpm test src/slack/format/readability-rules.spec.ts`를 돌린다. 기대: FAIL(모듈 없음).
- [ ] **Step 3: 구현.** `internal-terms.ts`의 `ALLOWED_SPANS`를 export해서 함께 쓴다. 검사 패턴은 다음과 같다.
  - `—`
  - `#\d+`: 앞이 `(`가 아니고, 뒤가 한글이나 영문자가 아니며, 링크 라벨 전체가 `#\d+`인 경우만 잡는다.
  - `\b(Daily Eval|Wins|Blockers|Work Reviewer|Headline|Before:|After:|careerLog|schemaVersion)\b`
  - `run #\d+`
  - `codex-cli|claude-cli`
- [ ] **Step 4:** jest-setup에서 `READABILITY_ENFORCED_SOURCES`에 든 파일의 결과에만 `findReadabilityViolations`를 돌려 `violations`에 넣는다. 처음 목록은 비어 있다.
- [ ] **Step 5:** `pnpm test src/slack/format`. 기대: PASS. 기존 spec도 모두 PASS(목록이 비어 있으므로).
- [ ] **Step 6: Commit** (요청 시) `test(slack): 메시지 가독성 검사기를 추가한다`

### Task 2: 아침 한 통 새 구성

**Files:**
- Modify: `src/autopilot/infrastructure/morning-digest.formatter.ts`, `morning-digest.formatter.spec.ts`
- Modify: `src/autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts:258-264`(PlanSection), `:350-383`(digestInput·detailText), `:452-505`(buildPlanSection)
- Modify: `src/slack/format/schedule-briefing.formatter.ts`(줄 목록 함수 추가), 해당 spec
- Modify: `src/agent/pm/domain/prompt/pm-system.prompt.ts`(title 규칙 한 줄)
- Modify: `src/slack/format/readability-rules.ts`(목록에 `autopilot/infrastructure/morning-digest.formatter.ts`, `autopilot/infrastructure/tasks/morning-briefing.autopilot-task.ts` 추가)

**Interfaces:**
- Produces:
  - `MorningTodo { title: string; url: string | null; dayCount: number | null }`
  - `MorningDigestInput`의 바뀐 필드
    - `company`를 지운다.
    - `todos: MorningTodo[] | null`을 더한다. null은 계획 생성 실패, `[]`는 할 일 없음이다.
    - `planFailure: string | null`을 더한다.
    - `schedules: string[] | null`을 더한다. 이미 줄로 만든 일정이고, null은 조회 실패다.
  - `formatScheduleLines(items: ScheduleItemRecord[], today: Date): string[]`(schedule-briefing.formatter.ts). 줄 형식은 `• 14:00 팀 회의`, `• 이력서 제출 (오늘)`, `• 보고서 제출 (3일 지남)`이다. 규칙은 `formatUpcomingLine`과 같다: OPEN만, `isHoliday` 제외, 지난 미완 마감 포함. 범위는 오늘까지다.
- Consumes: `DailyPlan.topPriority/morning/afternoon`, `DailyPlan.stalledTasks[].daysStalled`(`pm-agent.type.ts:42-65`)

- [ ] **Step 1: 실패하는 테스트 작성** (`morning-digest.formatter.spec.ts`, 기존 케이스는 새 구성으로 바꾼다)

```ts
it('네 칸을 순서대로 낸다', () => {
  const text = formatMorningDigest(base({
    todos: [{ title: '상벌점 입장 링크 확인', url: 'https://g/1', dayCount: null },
            { title: '공지 첨부파일 저장 오류 고치기', url: null, dayCount: 3 }],
    incidents: [{ label: '포트폴리오 사이트 발행 실패', dayCount: 2 }],
    resolvedIncidents: ['아침신문'],
    schedules: ['• 14:00 팀 회의'],
    invest: { buyCount: 2, sellCount: 1 },
  }));
  expect(text).toBe([
    '☀️ *11/4(수) 아침*', '',
    '*오늘 할 일*', '• <https://g/1|상벌점 입장 링크 확인>', '• 공지 첨부파일 저장 오류 고치기 (3일째)', '',
    '*어제 장애*', '• 포트폴리오 사이트 발행 실패 (2일째)', '• 아침신문, 지금은 복구됨', '',
    '*오늘 일정*', '• 14:00 팀 회의', '',
    '*그 밖에*', '• 투자: 오늘 시가 매수 2, 매도 1 예정',
  ].join('\n'));
});
it('할 일이 null 이면 실패 안내 한 줄', () => {
  expect(formatMorningDigest(base({ todos: null, planFailure: '시간 초과' })))
    .toContain('*오늘 할 일*\n• 오늘 계획을 만들지 못했어요 (시간 초과)');
});
it('할 일이 0개면 빈 안내', () => {
  expect(formatMorningDigest(base({ todos: [] }))).toContain('• 오늘 자동 수집된 할 일이 없어요');
});
it('장애·일정·그 밖에가 비면 그 칸을 그리지 않는다', () => {
  expect(formatMorningDigest(base({ todos: [] }))).not.toContain('*어제 장애*');
});
it('할 일은 최대 5개, 나머지는 "외 N개"', () => { /* 7개 넣고 '• 외 2개' 확인 */ });
```

- [ ] **Step 2:** `pnpm test morning-digest.formatter`. 기대: FAIL.
- [ ] **Step 3: `formatMorningDigest(input: MorningDigestInput): string` 구현**
  - 칸 순서는 `오늘 할 일`, `어제 장애`, `오늘 일정`, `그 밖에`다. 소제목은 `*…*`만 있는 줄로 둔다. 공통 렌더가 header 블록으로 올리게 하려는 것이다.
  - 첫 줄은 `☀️ *{formatTradeDay} 아침*`이다.
  - 장애가 있으면 `☀️ *11/4(수) 아침* 🔴 장애 1`처럼 개수만 붙인다. 이름은 장애 칸에 있다.
  - "그 밖에"에 들어가는 줄: 승인 대기 `• 승인 대기 2장 (블로그, 경력)`, 투자, 공고 `• 새 공고 3건 (A사, B사 외 1), 목록은 댓글에`, 공부 `• 공부: <url|주제> 15분`, 포트폴리오 `• 포트폴리오: 어제 …`.
  - 구분자는 `·`, `:`, 쉼표만 쓴다.
- [ ] **Step 4: morning-briefing task 수정**
  - `buildPlanSection`이 `todos`를 돌려준다. 만드는 법:
    - `topPriority`, `morning`, `afternoon`을 id로 중복 제거하고 순서를 지킨다.
    - `dayCount`는 `stalledTasks`의 `daysStalled`를 id로 매칭한다. 없으면 null이다.
  - `planFailure`는 실패 사유다. 실패 사유를 장애 줄로 올리던 `detectedIncidents`의 계획 실패 항목은 지운다. 이제 할 일 칸이 말해 준다.
  - `detailText`에서 PM 계획 전문(`plan.thread`)을 뺀다. 공고 스레드만 남긴다. `formatDailyPlan`, `appendPortfolioValue`, `formatModelFooter` 호출도 이 경로에서 지운다.
  - `schedules`는 `listSchedules.execute({ slackUserId, to: 오늘 KST 자정 UTC })`에 `formatScheduleLines`를 적용해 만든다. 실패하면 null이다.
- [ ] **Step 5:** `pm-system.prompt.ts`의 TaskItem 규칙에 한 줄을 더한다. "`title`은 무슨 일인지 쉬운 한국어 한 구절로 쓴다. GitHub·Notion 제목을 그대로 옮기지 않고 `#번호`를 넣지 않는다."
- [ ] **Step 6:** `pnpm test morning`, `pnpm test schedule-briefing`, `pnpm test pm-system`. 기대: PASS. 가독성 검사 위반 0이어야 한다.
- [ ] **Step 7: Commit** (요청 시) `feat(autopilot): 아침 한 통을 할 일·장애·일정 네 칸으로 바꾼다`

### Task 3: 저녁 한 통 새 구성

**Files:**
- Modify: `src/autopilot/infrastructure/evening-digest.formatter.ts`, spec
- Modify: `src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts:230-310`(digest 입력 조립)
- Modify: `readability-rules.ts` 목록(위 두 파일)

**Interfaces:**
- Produces: `EveningRetroContext`에 `problem: string | null`, `tryNext: string | null`을 더한다. 둘 다 회고의 Problem·Try 칸에서 온다. `keep`을 만드는 `parsed.retrospective`(`:300`)와 같은 출처다.
- 계좌 이름표를 바꾼다: `ACCOUNT_LABEL = { LONG_TERM: '장기투자', SWING: '단기매매', DEFAULT: '기본' }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('한 일·아쉬운 점·잘한 점·내일 추천·그 밖에 순서', () => {
  const text = formatEveningDigest(base({
    mergedPrCount: 4, keep: '원인을 오전에 찾아 같은 날 고쳤다.',
    problem: '리뷰 요청이 늦어 답이 내일로 밀렸다.', tryNext: '리뷰 요청은 오전에 먼저 보낸다.',
  }));
  expect(text).toBe([
    '🌙 *11/4(수) 마감*', '',
    '*한 일*', '• PR 4건 머지', '',
    '*아쉬운 점*', '• 리뷰 요청이 늦어 답이 내일로 밀렸다.', '',
    '*잘한 점*', '• 원인을 오전에 찾아 같은 날 고쳤다.', '',
    '*내일 추천*', '• 리뷰 요청은 오전에 먼저 보낸다.',
  ].join('\n'));
});
it('머지 조회 실패는 건수 대신 "확인하지 못했어요"', () => { /* mergedPrCount: null */ });
it('회고 실패는 한 줄 안내, 줄표 없음', () => {
  expect(formatEveningDigest(base({ retroFailure: '시간 초과' })))
    .toContain('_회고를 만들지 못했어요 (시간 초과). 내일 다시 시도해요._');
});
it('투자·승인 대기·장애는 "그 밖에"로', () => { /* '• 장기투자 수익률 +1.2%' 확인 */ });
```

- [ ] **Step 2:** `pnpm test evening-digest`. 기대: FAIL.
- [ ] **Step 3:** `formatEveningDigest(input: EveningDigestInput): string`을 구현한다.
  - 각 문장은 `firstSentence`로 60자까지 자른다.
  - 비어 있는 칸은 그리지 않는다.
  - 소제목 규칙은 Task 2와 같다.
- [ ] **Step 4:** task가 `problem`, `tryNext`를 넘기게 고친다. 회고가 malformed면 셋 다 null이다.
- [ ] **Step 5:** `pnpm test evening`. 기대: PASS.
- [ ] **Step 6: Commit** (요청 시) `feat(autopilot): 저녁 한 통을 한 일·아쉬운 점·추천으로 바꾼다`

### Task 4: 모델 푸터 제거와 콘솔 보고 라벨

**Files:**
- Delete: `src/slack/format/model-footer.formatter.ts`와 spec. 호출 11곳(`grep -rn "formatModelFooter(" src`)도 함께 지운다.
- Modify:
  - `src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts:145`
  - `src/slack/format/po-evaluation.formatter.ts:37-124`
  - `src/autopilot/infrastructure/tasks/work-reviewer.autopilot-task.ts:114`
  - `src/slack/format/daily-review.formatter.ts:40-41`
  - `src/slack/format/impact-report.formatter.ts:12`
  - `src/slack/format/ceo-meta.formatter.ts:59-68`
  - 위 파일들의 spec
- Modify: `readability-rules.ts` 목록에 위 파일 전부를 더한다.

**Interfaces:** 없음(문자열만 바뀐다).

라벨 바꿈표:

| 지금 | 바뀜 |
|---|---|
| `Daily Eval — {date} (19:40 KST 자동 회고)` | `하루 평가 {M/D(요일)}` |
| `Wins` | `잘된 것` |
| `Blockers` | `막힌 것` |
| `📝 *Work Reviewer — …*` | `📝 *업무 회고 {M/D(요일)}*` |
| `Headline` | `한 줄 요약` |
| `Before:` / `After:` | `바뀌기 전:` / `바뀐 뒤:` |
| `💼 이력서용 careerLog … (schemaVersion=1)` 섹션 | 메시지에서 지운다. 출력 JSON 저장은 그대로 둔다 |
| `합성 source: …`, `missing: …` 줄 | 지운다 |

- [ ] **Step 1:** 각 formatter spec의 기대 문자열을 위 표대로 고친다. 지워지는 줄은 `not.toContain`으로 확인한다.
- [ ] **Step 2:** `pnpm test`. 기대: 고친 spec FAIL.
- [ ] **Step 3:** 문자열을 바꾸고 푸터 호출을 지운다. 슬래시 응답 헬퍼 `slack-handler.helper.ts:88`도 포함한다.
- [ ] **Step 4:** `pnpm test && pnpm build`. 기대: PASS. 가독성 위반 0이어야 한다.
- [ ] **Step 5: Commit** (요청 시) `refactor(slack): 보고서의 영어 라벨과 run 푸터를 걷어 낸다`

### Task 5: 승인 카드 짧은 문장

**Files:**
- Modify: `prisma/schema.prisma`의 `PreviewAction`에 `slackText String? @map("slack_text") @db.Text`를 추가한다. 추가만 한다.
- Modify: `src/preview-gate/domain/preview-action.type.ts:110-149`(생성 입력·레코드에 `slackText?: string | null`)
- Modify: preview 저장 repository(`src/preview-gate/infrastructure/*.prisma.repository.ts`)
- Modify: `src/slack/format/preview-message.builder.ts:19-40`. `buildPreviewBlocks`에 `slackText?: string | null`을 받아 `slackText ?? previewText`로 그린다.
- Modify:
  - 블로그 후보 카드 `evening-retro-publish.autopilot-task.ts:343-346`
  - 경력 반영 카드 `:370` 부근
  - GitHub 발행 카드 `blog-github-publish.autopilot-task.ts:145-168`
- Test: `preview-message.builder.spec.ts`, 위 task spec

**Interfaces:**
- Produces: `buildPreviewBlocks({ previewText, slackText?, previewId, kind?, payload? })`

카드 문구:
- 블로그 후보: `📝 *블로그 발행할까요?*\n제목: {title}\n어디로: 노션 블로그\n왜: {쓸 가치 한 줄}\n_승인하면 초안을 만들어 노션에 올려요._`
- GitHub 발행: `🌐 *GitHub에 공개할까요?*\n제목: {title}\n첫 문단: {본문 첫 문단 120자}`. 전문 첨부 파일은 그대로 둔다.
- 경력 반영: `💼 *경력 기록에 반영할까요?*\n{무엇이 어떻게 바뀌는지 한 줄}`. 바뀐 전문은 `previewText`에 남기고, 입력칸 안내는 그대로 둔다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('slackText 가 있으면 그것으로 그린다', () => {
  const blocks = buildPreviewBlocks({ previewText: '전문', slackText: '짧게', previewId: 'p1' });
  expect(JSON.stringify(blocks)).toContain('짧게');
  expect(JSON.stringify(blocks)).not.toContain('전문');
});
it('slackText 가 없는 옛 행은 previewText 로 그린다', () => {
  expect(JSON.stringify(buildPreviewBlocks({ previewText: '전문', previewId: 'p1' }))).toContain('전문');
});
```

  블로그 후보 task spec에는 `slackText`가 위 문구와 같고 `previewText`에 근거 PR이 남아 있는지 확인하는 케이스를 더한다.
- [ ] **Step 2:** `pnpm test preview-message`. 기대: FAIL.
- [ ] **Step 3:** 구현한다. `pnpm prisma format && pnpm prisma:generate`를 돌린다. `pnpm db:push`는 메인 트리의 `.env`를 복사한 뒤 돌린다(가드 출력에 DROP이 없어야 한다).
- [ ] **Step 4:** `pnpm test && pnpm build`. 기대: PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(preview-gate): 승인 카드에 짧은 문장을 따로 둔다`

### Task 6: 장애 알림과 "AI에 맡기기" 블록

**Files:**
- Create: `src/notification/domain/incident-message.ts`, `incident-message.spec.ts`
- Modify: `src/notification/infrastructure/notification.consumer.ts:357-386`(`openText`, `remindText`, `resolveText`), 발송부(`:197`, `:251`, `:406`)
- Modify: `src/common/util/pii-redaction.util.ts`(패턴 2개 추가), spec
- Modify: `internal-terms.jest-setup.ts`의 감싸는 대상에 `notification/domain/incident-message.ts`를 더하고, 가독성 목록에도 넣는다.

**Interfaces:**
- Produces:
  - `describeIncidentCause(errorMessage: string): string | null`. 고정 사전으로 바꾼다.
    - `/Not logged in|401|unauthorized|token.*expired/i` → `로그인이 만료된 것 같아요`
    - `/quota|rate limit|429/i` → `사용량 한도에 걸렸어요`
    - `/timeout|timed out|ETIMEDOUT/i` → `응답 시간이 초과됐어요`
    - `/ECONNREFUSED|ENOTFOUND|socket hang up/i` → `연결이 끊겼어요`
    - 없으면 null.
  - `formatIncidentOpen({ label, cause, nextRunAt }: { label: string; cause: string | null; nextRunAt: string | null }): string`
  - `formatIncidentRemind({ label, dayCount, occurrences, cause }): string`
  - `formatIncidentResolved({ label, duration, occurrences }): string`
  - `formatAiHandoff({ feature, errorMessage, files, checkCommand }: { feature: string; errorMessage: string; files: string[]; checkCommand: string | null }): string`. 안내 한 줄과 코드 블록 하나를 만든다. 원문은 `redactPii`를 거치고, 원문 속 백틱 세 개는 바꿔 쓴다.
- `pii-redaction.util.ts`에 더할 패턴: `https?://[^\s:@/]+:[^\s@/]+@` → `https://***@`, `/(password|passwd|pwd)\s*[=:]\s*\S+/gi` → `$1=***`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('본문은 네 줄, 오류 원문 없음', () => {
  const text = formatIncidentOpen({ label: '포트폴리오 사이트 발행', cause: '로그인이 만료된 것 같아요', nextRunAt: '내일 08:00' });
  expect(text).toBe('🔴 *포트폴리오 사이트 발행이 멈췄어요*\n원인: 로그인이 만료된 것 같아요 (추정)\n지금 상태: 내일 08:00에 다시 시도해요.');
});
it('원인을 모르면 "원인 확인 중"', () => {
  expect(formatIncidentOpen({ label: 'x', cause: null, nextRunAt: null })).toContain('원인: 확인 중');
});
it('AI 블록은 토큰·URL 자격증명·password 를 가리고 펜스를 깨지 않는다', () => {
  const text = formatAiHandoff({ feature: 'x', errorMessage: 'xoxb-123-abc https://u:p@h/x password=hunter2 ```', files: [], checkCommand: null });
  expect(text).not.toMatch(/xoxb-123|u:p@|hunter2/);
  expect(text.match(/```/g)).toHaveLength(2);
});
it('describeIncidentCause 매핑', () => {
  expect(describeIncidentCause('Not logged in · Please run /login')).toBe('로그인이 만료된 것 같아요');
  expect(describeIncidentCause('weird')).toBeNull();
});
```

  본문의 "무슨 일"과 "영향" 줄은 `label`만으로는 말할 수 없다. 그래서 1단계에서는 제목 줄이 그 역할을 맡는다. 영향 문구 사전은 3단계 이후 과제로 둔다.
- [ ] **Step 2:** `pnpm test incident-message pii-redaction`. 기대: FAIL.
- [ ] **Step 3:** 구현한다. 발송부는 본문을 `postMessage`로 보낸 뒤, 돌아온 `ts`로 같은 대상에 `thread_ts`를 붙여 `formatAiHandoff`를 보낸다. 스레드 발송이 실패해도 본문 발송은 성공으로 둔다.
- [ ] **Step 4:** `pnpm test notification`. 기대: PASS.
- [ ] **Step 5: Commit** (요청 시) `feat(notification): 장애 알림을 쉬운 설명과 AI 블록으로 나눈다`

### Task 7: PR 리뷰 메시지

**Files:**
- Modify: `src/slack/format/pull-request-review.formatter.ts`, spec
- Modify: `src/agent/code-reviewer/infrastructure/code-reviewer.consumer.ts:51` 부근(본문 발송 후 스레드에 AI 블록)
- Modify: `readability-rules.ts` 목록

**Interfaces:**
- Consumes: Task 6 `formatAiHandoff`. `feature`에는 PR 링크와 제목, `errorMessage`에는 지적 원문을 모아서, `files`에는 지적 파일:라인을 넣는다.
- Produces: `formatPullRequestReview`가 본문을 다음 순서로 낸다: `*{PR 이름} 리뷰*`, `고칠 것 N개` 한 줄 요약, 지적마다 `• {쉬운 말 한 줄}`. 지적 원문은 스레드로 보낸다.

- [ ] **Step 1:** spec 기대 문자열을 고친다. 본문에 지적 원문과 `PR_REVIEW_INLINE_REPOS` 같은 env 이름이 없어야 한다.
- [ ] **Step 2:** FAIL을 확인하고 구현한 뒤 PASS를 확인한다.
- [ ] **Step 3: Commit** (요청 시) `feat(code-reviewer): PR 리뷰 본문을 쉬운 요약으로 바꾼다`

### Task 8: 프롬프트 공통 글쓰기 규칙

**Files:**
- Create: `src/common/llm/reader-writing-rules.ts`
- Modify (규칙 블록을 넣을 프롬프트):
  - `src/agent/work-reviewer/domain/prompt/work-reviewer-system.prompt.ts`
  - `src/agent/po-eval/domain/prompt/po-eval-system.prompt.ts`
  - `src/agent/impact-reporter/domain/prompt/impact-reporter-system.prompt.ts`
  - `src/agent/blog/domain/prompt/evening-retro.prompt.ts`
  - `src/agent/career-mate/domain/prompt/*.prompt.ts`
  - `src/agent/paper-recommend/domain/prompt/paper-recommend-system.prompt.ts`
  - `src/agent/code-reviewer` 시스템 프롬프트
  - `src/fact-answer/domain/fact-answer.prompt.ts`
  - `src/agent/pm/domain/prompt/pm-system.prompt.ts`
- Test: `src/common/llm/reader-writing-rules.spec.ts`

**Interfaces:**
- Produces: `READER_WRITING_RULES: string`. 아래 문구를 고정한다.

```
## 읽는 사람
대표 한 사람이 휴대폰으로 읽는다. 처음 보는 사람도 알아듣게 쓴다.
- 줄표(—)를 쓰지 않는다. 쉼표나 줄바꿈으로 나눈다.
- PR·이슈를 번호만으로 부르지 않는다. 무슨 일인지 한국말 한 구절로 쓴다.
- 영어 라벨, 내부 이름(워커 이름, 상태값, 환경변수), 모델 이름을 쓰지 않는다.
- 오류 원문을 옮기지 않는다. 무엇이 멈췄는지만 쓴다.
- 한 문장은 60자 안팎으로 짧게 쓴다.
```

- [ ] **Step 1:** 테스트를 쓴다. 위 프롬프트 각각에 `READER_WRITING_RULES`가 포함됐는지 `it.each`로 확인한다.
- [ ] **Step 2:** FAIL을 확인하고, 각 프롬프트 끝(출력 형식 절 앞)에 넣은 뒤 PASS를 확인한다.
  - 프롬프트에 이미 "UNKNOWN 예시"나 충돌하는 문체 규칙이 있으면 덧붙이지 말고 치환한다(AGENTS §4 #14와 같은 원리).
  - 예: `po-shadow-system.prompt.ts`의 headline 예시에 있는 `PR #3922` 번호 표기를 고친다.
- [ ] **Step 3: Commit** (요청 시) `feat(llm): 보고서 프롬프트에 읽는 사람 규칙을 넣는다`

### Task 9: 줄표 걷어 내기와 전체 검사

**Files:**
- Modify: `src/autopilot/infrastructure/tasks/portfolio-publish.autopilot-task.ts:68`, `morning-briefing.autopilot-task.ts:228-252`. 구분자 상수 `PORTFOLIO_REASON_SEPARATOR = ': '`와 `PORTFOLIO_BULLET_SEPARATOR = ': '`를 생산자 파일에 export하고 소비자가 import한다.
- Modify: `src/**/*.formatter.ts`, `src/**/*.autopilot-task.ts`, `src/notification/**`, `src/slack/handler/**`의 사람에게 보이는 문자열 속 `—`. 주석은 그대로 둔다.
- Modify: `src/slack/format/readability-rules.ts`. 목록 검사를 지우고, jest-setup이 감싸는 모든 결과에 검사를 건다.
- Modify: `internal-terms.jest-setup.ts`의 감싸는 대상에 `src/slack/handler/**/*.handler.ts`의 export 문자열 상수를 더한다. 못 감싸는 `ack`/`respond` 즉석 문구는 "알고 둔 구멍" 주석에 그대로 남긴다.
- Modify: `paper-trading.formatter.ts`, `paper-number.formatter.ts`, `paper-score.formatter.ts`의 `LONG_TERM`·`SWING` 노출 → `장기투자`·`단기매매`(Task 3의 `ACCOUNT_LABEL`을 export해 같이 쓴다)

**Interfaces:**
- Produces: `PORTFOLIO_REASON_SEPARATOR`, `PORTFOLIO_BULLET_SEPARATOR`(portfolio-publish task), `PAPER_ACCOUNT_LABEL`(evening-digest.formatter에서 export)

- [ ] **Step 1: 실패하는 테스트 작성** (morning-briefing spec)

```ts
it('포트폴리오 실패 사유를 구분자 상수로 읽는다', () => {
  // portfolio-publish 가 만든 `${HEADER}${PORTFOLIO_REASON_SEPARATOR}사이트 API 401` 원장 행을 넣는다.
  // 아침 장애 줄이 '포트폴리오 사이트 발행 실패 (사이트 API 401)' 이고 사유에 구분자가 섞이지 않음을 확인한다.
});
```

- [ ] **Step 2:** `readability-rules.ts`를 전체 검사로 바꾸고 `pnpm test`를 돌린다. 기대: 위반 목록이 나온다. 이 목록이 고칠 대상이다.
- [ ] **Step 3:** 위반을 고친다. 각 spec의 기대 문자열도 같이 고친다. 고친 spec 목록은 PR 본문에 적는다.
- [ ] **Step 4:** 완료 게이트를 전부 돌린다. 기대: 모두 exit 0이다.

```bash
pnpm lint:check && pnpm test && pnpm build
node --env-file=.env scripts/check-di.cjs
pnpm check:env && pnpm docs:check && pnpm check:invariants && pnpm test:e2e
```

- [ ] **Step 5: Commit** (요청 시) `refactor(slack): 사람에게 보이는 문자열에서 줄표를 걷어 낸다`

### Task 10: 실발송 확인

- [ ] **Step 1:** 메인 트리 앱을 끄지 않는다(PORT 충돌 주의). worktree에서 `pnpm dev`를 띄우지 말고, 머지 뒤 다음 날 08:30 아침 한 통과 19:40 저녁 한 통을 대표가 읽어 확인한다.
- [ ] **Step 2:** 첫 발송 뒤 `slack_delivery`에서 그날 아침·저녁 행의 글자 수를 확인한다. 기대: 아침 600자 안팎 이하.
- [ ] **Step 3:** 2주 뒤 `slack_delivery`의 반응 수·답글 수를 개편 전 2주와 비교한다. 결과는 검증 노트로 남긴다.

---

## 2단계·3단계 (별도 계획)

1단계 머지 뒤 각각 계획을 쓴다. 계획에 반드시 담을 것은 spec의 「구현 전에 정해 둔 것」과 「바꾸는 순서」에 있다.

- **2단계 할 일 추적**
  - 할 일 저장소와 날짜별 아침 목록
  - 자동 완료
  - 저녁 숫자 세 가지
  - GitHub 리뷰 요청 시각 조회
  - 차례 enum
- **3단계 주간 일 점검**
  - PO 재설계, PM 선행조건 제거
  - 재실행 기간 저장
  - PO_EVAL 입력
  - 목표 후보 제안(`GoalQuestion` 칸)
  - 판정 버튼 제거
  - 주간 요약 회수 줄 삭제
