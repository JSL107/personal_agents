# 윤문 규칙 연구 루프 개선 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `HUMANIZE_RESEARCH` 가 블로그·정본 양쪽에 근거 있는 규칙 제안을 내고, 사람이 승인 카드로 PR 을 열 수 있게 한다.

**Architecture:** 3개 순차 PR. PR1 은 재료(수집기·선별)만 바꾼다. PR2 는 제안 형식과 결정적 게이트 1~6을 넣되 쓰기는 하지 않는다. PR3 은 정본 임시 worktree 검사(게이트 7), Preview Gate kind `HUMANIZE_RULE_PR`, PR 반영을 넣는다.

**Tech Stack:** NestJS 11, TypeScript, Jest, Prisma(조회만), git CLI(`runGit`), python3(정본 검사), Octokit(`pushBranchAndOpenPr`).

**Spec:** `docs/superpowers/specs/2026-11-16-humanize-research-loop-design.md` (선행: `2026-10-23-humanize-research-worker-design.md`)

## Global Constraints

- 패키지 매니저 `pnpm` 만 쓴다. 각 PR 은 `pnpm verify` green 이 끝의 정의다(AGENTS.md §1).
- env 를 추가하면 `.env.example`·`.env`·`src/config/app.config.ts`·README 4곳을 갱신하고, `pnpm docs:sync` 뒤 `pnpm docs:check` 를 돌린다. `docs/env-catalog.md` 는 `git add -f` 로 스테이징한다.
- `process.env` 를 직접 참조하지 않는다. `ConfigService.get` 을 쓴다.
- NestJS 생성자에 기본값 파라미터를 두지 않는다. 메서드 인자 기본값은 허용된다.
- 코드 스타일은 AGENTS.md §2를 따른다: `catch (error)`, if 는 항상 중괄호, try 안에서는 `return await`, 인라인 반환 타입 금지.
- 정본 저장소(`~/.claude/skills/humanize-korean`)에는 `fetch`·`worktree add/remove` 외의 쓰기 git 명령을 실행하지 않는다. 라이브 폴더 파일을 직접 고치지 않는다.
- 외부 텍스트(블로그 diff·커밋 메시지·upstream·arXiv)는 `wrapUntrustedInput()` 으로 감싼다(기존 `renderItem` 규칙 유지).
- 회차당 제안 상한은 `HUMANIZE_RESEARCH_MAX_PROPOSALS = 3`, 입력 예산은 `HUMANIZE_RESEARCH_INPUT_LIMIT = 60_000` 그대로 둔다.
- **커밋 단계는 사용자가 커밋을 요청했을 때만 실행한다.** 계획의 commit 단계는 그 시점의 메시지 안이다.

## Review Focus

1. **옛 원장 `processed` 에 `canonHead` 가 없다** — 첫 회차로 리셋되면 안 된다. 블로그·arXiv 처리 기록은 유지되고 `canonHead` 만 `null` 로 읽혀야 한다(Task 4 테스트).
2. **정본 저장소 경로가 없거나 git 이 실패한다** — CANON_LOG 만 `FAILED` 가 되고 회차는 계속 돌아야 한다(Task 4 테스트).
3. **diff 에 같은 줄이 여러 번, 빈 줄, 한쪽만 있는 경우** — 짝짓기가 크래시 없이 `DELETED`/`ADDED` 로 분류해야 한다(Task 1 테스트).
4. **삭제 제안의 `oldString` 이 표 행인데 끝 개행이 있거나 없다** — 둘 다 같은 판정을 받아야 한다(Task 9 테스트).
5. **승인 시점에 대상 파일 본문이 비어 온다**(GitHub 1MB 초과 등, `content` 미존재) — `STALE_PROPOSAL` 이 아니라 "본문을 못 받았다"는 실패 메시지로 끝나야 한다(Task 12 테스트).

---

## PR1 — 재료 보강

### Task 1: 블로그 편집 요약

**Files:**
- Create: `src/agent/humanize-research/domain/blog-edit-summary.ts`
- Test: `src/agent/humanize-research/domain/blog-edit-summary.spec.ts`

**Interfaces:**
- Consumes: `RevisionLineChanges` (`src/agent/blog/domain/revision-rate.ts`)
- Produces:
  - `enum BlogEditKind { PUNCTUATION_ONLY, LEXICAL, REWRITE, DELETED, ADDED }` (문자열 값은 키와 같다)
  - `interface BlogEditSummary { counts: Record<BlogEditKind, number>; examples: Record<BlogEditKind, BlogEditExample[]> }`
  - `interface BlogEditExample { before: string; after: string }`
  - `summarizeBlogEdits(changes: RevisionLineChanges): BlogEditSummary`
  - `renderBlogEditSummary({ path, summary }: { path: string; summary: BlogEditSummary }): string`
  - `hashBlogChanges(changes: RevisionLineChanges): string` — sha1 앞 8자

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `'쉼표만 다른 짝은 PUNCTUATION_ONLY'`: removed `['처리하고, 저장한다']`, added `['처리하고 저장한다']` → `counts.PUNCTUATION_ONLY === 1`, 나머지 0.
  - `'예시는 종류별 최대 3쌍'`: 쉼표 짝 5개 → `counts.PUNCTUATION_ONLY === 5`, `examples.PUNCTUATION_ONLY.length === 3`.
  - `'짝이 없으면 DELETED·ADDED'`: removed `['가나다라마바사']`, added `['완전히 다른 새 문장입니다']` → `DELETED 1`, `ADDED 1`.
  - `'빈 줄·중복 줄에서 크래시 없음'`: removed `['', 'A, B', 'A, B']`, added `['A B']` → 예외 없이 `PUNCTUATION_ONLY 1`, `DELETED 1`(빈 줄은 세지 않는다).
  - `'렌더 결과는 4,000자 이하'`: 2,000자 줄 10쌍 → `renderBlogEditSummary(...).length <= 4000`.
  - `'같은 변경은 같은 해시, 다른 변경은 다른 해시'`.
- [ ] **Step 2: 실행해 실패를 확인한다** — `pnpm test -- blog-edit-summary` → FAIL(모듈 없음).
- [ ] **Step 3: 구현한다.** 빈 줄(trim 후 '')은 버린다. 각 removed 줄에 대해 아직 안 쓴 added 줄 중 문자 bigram Dice 계수가 가장 높은 것을 고른다. 0.5 이상이면 짝이다. 짝의 분류 기준은 다음과 같다.
  - 공백·구두점(`/[\s\p{P}]/gu`)을 지운 두 문자열이 같으면 `PUNCTUATION_ONLY`
  - 그 외 Dice 0.8 이상이면 `LEXICAL`
  - 나머지 짝은 `REWRITE`
  - 짝이 없는 removed 줄은 `DELETED`, 남은 added 줄은 `ADDED`

  렌더는 `발행 경로: <path>` + 종류별 `N건` + 예시(`- 전: …` / `- 후: …`, 줄당 300자 절단)이다. 4,000자를 넘으면 예시를 뒤에서부터 뺀다.
- [ ] **Step 4: 통과를 확인한다** — `pnpm test -- blog-edit-summary` → PASS.

### Task 2: 블로그 수집기 — 해시 id·56일 창

**Files:**
- Modify: `src/agent/blog/application/measure-blog-revision.usecase.ts:33,70,114` (`execute` 가 창 인자를 받는다)
- Modify: `src/agent/humanize-research/infrastructure/collectors/blog-revision.collector.ts`
- Modify: `src/agent/humanize-research/domain/humanize-research.constant.ts` (`BLOG_LOOKBACK_DAYS = 56` 추가)
- Test: `src/agent/humanize-research/infrastructure/collectors/blog-revision.collector.spec.ts`, `src/agent/blog/application/measure-blog-revision.usecase.spec.ts`

**Interfaces:**
- Consumes: Task 1 `summarizeBlogEdits`, `renderBlogEditSummary`, `hashBlogChanges`
- Produces: `MeasureBlogRevisionUsecase.execute(options: { lookbackDays?: number } = {}): Promise<BlogRevisionReport>` — 기본 28. 블로그 항목 id 형식은 `blog:<path>:<publishedAtISO>:<hash8>`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - collector: `'measure 를 lookbackDays 56 으로 부른다'` (`execute` 가 `{ lookbackDays: 56 }` 로 호출됐는지).
  - collector: `'id 에 변경 해시가 붙고, 변경이 달라지면 새 id'` — 같은 path·publishedAt 이라도 changes 가 다르면 id 가 다르고, 처리 목록에 옛 id 만 있으면 새 항목으로 수집된다.
  - collector: `'텍스트는 renderBlogEditSummary 결과'` — 원시 줄 목록(`삭제된 줄:`)이 들어가지 않는다.
  - measure: `'인자 없으면 28일 창'` — `findRecentAppliedPreviews.execute` 의 `since` 가 28일 전이다.
- [ ] **Step 2: 실패 확인** — `pnpm test -- blog-revision measure-blog-revision` → FAIL.
- [ ] **Step 3: 구현한다.** collector 의 `since` 필터도 `BLOG_LOOKBACK_DAYS` 를 쓴다. `BLOG_REVISION` 쪽 호출부는 바꾸지 않는다(기본값 28 유지).
- [ ] **Step 4: 통과 확인** — 같은 명령 → PASS.

### Task 3: HUMANIZER 신호 — 블로그 윤문만

**Files:**
- Modify: `src/agent/humanize-research/infrastructure/collectors/humanizer-signals.collector.ts:93-97`
- Test: `src/agent/humanize-research/infrastructure/collectors/humanizer-signals.collector.spec.ts`

**Interfaces:**
- Consumes: `AgentRunService.findRecentSucceededRuns({ inputSnapshotEquals })` (`InputSnapshotEquals = { path: string[]; value: string }`)

- [ ] **Step 1: 실패하는 테스트를 쓴다** — `'personal-blog voice 만 조회한다'`: `findRecentSucceededRuns` 가 `inputSnapshotEquals: { path: ['voice'], value: 'personal-blog' }` 로 호출된다. 텍스트 첫 줄은 `블로그 윤문 회차 N건` 이다.
- [ ] **Step 2: 실패 확인** — `pnpm test -- humanizer-signals` → FAIL.
- [ ] **Step 3: 구현한다.** 인자 하나를 추가하고 첫 줄 라벨을 바꾼다.
- [ ] **Step 4: 통과 확인** → PASS.

### Task 4: CANON_LOG 수집기 + `processed.canonHead`

**Files:**
- Create: `src/agent/humanize-research/infrastructure/collectors/canon-log.collector.ts`
- Test: `src/agent/humanize-research/infrastructure/collectors/canon-log.collector.spec.ts`
- Modify: `src/agent/humanize-research/domain/humanize-research.type.ts` (`HumanizeResearchSource.CANON_LOG`, `Processed.canonHead: string | null`)
- Modify: `src/agent/humanize-research/domain/humanize-research-input.ts` (`advanceProcessed` 가 `canonHead` 전진)
- Modify: `src/agent/humanize-research/application/run-humanize-research.usecase.ts` (`readProcessed`, `EMPTY_PROCESSED`, `collectAll`)
- Modify: `src/agent/humanize-research/humanize-research.module.ts`
- Test: `src/agent/humanize-research/application/run-humanize-research.usecase.spec.ts`, `src/agent/humanize-research/domain/humanize-research-input.spec.ts`

**Interfaces:**
- Consumes: `runGit({ directory, args })` (`upstream-rule-diff.collector.ts`), `resolveHumanizeRulesRepoPath`
- Produces:
  - `CanonLogCollector.collect(processed: Processed): Promise<CollectionResult>`
  - 항목 id `canon:<최신 커밋 해시 전체>`. 회차당 항목은 최대 1개다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `'canonHead 가 조상이면 <head>..HEAD 범위'`: `merge-base --is-ancestor` exit 0 → `log` 인자에 `<head>..HEAD` 포함.
  - `'canonHead 가 없거나 조상이 아니면 최근 30일'`: `--since=30.days`.
  - `'커밋이 없으면 EMPTY'`.
  - `'git 실패면 FAILED 이고 throw 하지 않는다'` (exitCode 128).
  - `'본문은 커밋당 500자, 항목 전체 8,000자 이하'`. 텍스트에 `references/corpus/` 하위 변경 파일명이 들어간다.
  - usecase: `'옛 원장 processed(canonHead 없음)는 리셋되지 않는다'` — `{ humanizerMaxRunId:'1', blogPostIds:['blog:a'], upstreamHead:null, arxivIds:[] }` 를 읽으면 `blogPostIds` 가 유지되고 `canonHead === null` 이다.
  - input: `'CANON_LOG 항목이 포함되면 canonHead 가 그 해시로 전진'`.
- [ ] **Step 2: 실패 확인** — `pnpm test -- canon-log run-humanize-research humanize-research-input` → FAIL.
- [ ] **Step 3: 구현한다.** `git log --format=%H%x1f%s%x1f%b%x1e --name-only <range>` 를 파싱한다. `readProcessed` 는 `canonHead` 가 `undefined` 면 `null` 로 채우고, 나머지 형태 검사는 지금 그대로 둔다. 로컬 `HEAD` 기준이다(라이브 폴더는 사용자가 pull 로 맞춘다).
- [ ] **Step 4: 통과 확인** → PASS.

### Task 5: SAMPLE 폐지와 선별 우선순위

**Files:**
- Delete: `src/agent/humanize-research/infrastructure/model-sample.collector.ts`, `model-sample.collector.spec.ts`
- Modify: `humanize-research.type.ts` (`SAMPLE`, `SampleTopic`, `SampleOutcome` 제거), `humanize-research-input.ts` (`PRIORITY`), `run-humanize-research.usecase.ts`, `humanize-research.module.ts`, `src/slack/format/humanize-research.formatter.ts`(+spec, SAMPLE 라벨이 있으면 제거)
- Test: `humanize-research-input.spec.ts`

**Interfaces:**
- Produces: `PRIORITY = { BLOG:0, HUMANIZER:1, CANON_LOG:2, UPSTREAM:3, ARXIV:4 }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**
  - `'우선순위 BLOG → HUMANIZER → CANON_LOG → UPSTREAM → ARXIV'`.
  - `'블로그 14건(각 쉼표 짝 30쌍 요약)이 예산 절반 이하를 쓰고 탈락 0'` — Task 1 렌더로 만든 항목 14개 + quick-rules 13,182자 더미 → `droppedForBudget.length === 0`, 블로그 비용 합 ≤ `(HUMANIZE_RESEARCH_INPUT_LIMIT - prefix - system) / 2`. spec §9 PR1 인수 기준이다.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현한다.** `grep -rn "SAMPLE\|ModelSampleCollector" src` 가 0건이 될 때까지 지운다.
- [ ] **Step 4: 통과 확인** — `pnpm test -- humanize-research` → PASS.

### Task 6: 연결표 경보 정리

**Files:**
- Modify: `src/humanize/domain/humanize-rule-links.ts` (`prompt.translationese.light-verb`, `prompt.habit.comma-after-ending` 의 `note`)
- Modify: `src/humanize/domain/humanize-rule-links.snapshot.json` (`--accept` 로 생성)

- [ ] **Step 1: `note` 를 고친다.** 정확한 문구:
  - light-verb: `'원문 예시의 강도와 시제를 보존하도록 예문을 다시 썼다. 정본은 2026-11-02 에 3회+ S2 로 내렸으나 블로그는 사람이 최종 검수하므로 횟수 조건 없이 유지한다.'`
  - comma-after-ending: `'정본의 6회 이상 신호 기준 없이 만나면 쉼표를 뺀다. 정본은 2026-10-30 에 기술 블로그를 비대상으로 뺐으나, 사용자가 기술 블로그에서도 쉼표를 지우므로(#939 후처리) 의도적으로 무조건 제거를 유지한다.'`
- [ ] **Step 2: 실행** — `pnpm humanize:check-links --accept` 뒤 `pnpm humanize:check-links` → exit 0, `changed` 0건.
- [ ] **Step 3: PR1 게이트** — `pnpm verify` → exit 0.
- [ ] **Step 4: Commit (사용자 요청 시에만)**

```bash
git add src/agent/humanize-research src/agent/blog/application/measure-blog-revision.usecase.ts src/agent/blog/application/measure-blog-revision.usecase.spec.ts src/humanize/domain/humanize-rule-links.ts src/humanize/domain/humanize-rule-links.snapshot.json src/slack/format
git add -f docs/superpowers/specs/2026-11-16-humanize-research-loop-design.md docs/superpowers/plans/2026-11-16-humanize-research-loop.md  # docs/ 는 gitignore — 기존 spec 처럼 -f
git commit -m "feat(humanize-research): 연구 재료를 규칙에 닿는 형태로 바꾼다"
```

---

## PR2 — 제안 대상 확장과 게이트 1~6 (쓰기 없음)

### Task 7: 제안 형식 — `target`·`enforcementGaps`

**Files:**
- Modify: `humanize-research.type.ts`, `domain/prompt/humanize-research.prompt.ts`, `domain/humanize-research-output.ts`
- Test: `domain/humanize-research-output.spec.ts`

**Interfaces:**
- Produces:
  - `type ProposalTarget = 'canon' | 'blog'`
  - `HumanizeResearchProposal` 에 `target: ProposalTarget` 추가
  - `interface EnforcementGap { ruleId: string; evidence: string[] }`
  - `ParsedResearchOutput.enforcementGaps: EnforcementGap[]`, `HumanizeResearchOutput.enforcementGaps: EnforcementGap[]`
  - 출력 스키마: proposal `required` 에 `target`(enum `canon`·`blog`), 최상위 `enforcementGaps` 배열(required)

- [ ] **Step 1: 실패하는 테스트** — `'target 없는 제안은 INVALID_SHAPE'`, `'enforcementGaps 는 문자열 ruleId·근거 배열만 통과'`, `'enforcementGaps 가 없으면 빈 배열'`.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현한다.** 시스템 프롬프트에서 대상 파일을 적는 문장을 아래로 **치환한다**(덧붙이지 않는다).
  - `'target 이 canon 이면 file 은 references/quick-rules.md, 근거는 UPSTREAM·CANON_LOG·ARXIV item 이어야 한다. target 이 blog 이면 file 은 src/humanize/domain/humanize-system.prompt.ts, oldString 은 아래 「블로그 편집 가능 문구」 안에서 그대로 복사하고, 근거는 BLOG·HUMANIZER item 이어야 한다.'`
  - `'규칙이 이미 있는데 지켜지지 않는 것으로 보이면 제안하지 말고 enforcementGaps 에 규칙 id 와 근거 item id 를 적어라.'`
  - `'규칙을 지우려면 quick-rules 표 한 행 전체를 oldString 으로, newString 을 빈 문자열로 낸다.'`

  JSON 예시 문장도 새 형식으로 바꾼다.
- [ ] **Step 4: 통과 확인** → PASS.

### Task 8: 블로그 편집 가능 면 주입

**Files:**
- Create: `src/agent/humanize-research/domain/blog-editable-surface.ts`
- Test: `src/agent/humanize-research/domain/blog-editable-surface.spec.ts`
- Modify: `domain/humanize-research-input.ts` (`selectResearchInput` 에 `blogSurface: string` 인자, prefix 에 포함)

**Interfaces:**
- Consumes: `HUMANIZE_RULE_LINKS`, `HumanizeRuleLink` (`src/humanize/domain/humanize-rule-links*.ts`)
- Produces:
  - `BLOG_PROMPT_FILE = 'src/humanize/domain/humanize-system.prompt.ts'`
  - `blogEditableTexts(links: readonly HumanizeRuleLink[]): string[]` — `local.file === BLOG_PROMPT_FILE` 인 `local.text`
  - `renderBlogEditableSurface(texts: string[]): string` — `블로그 편집 가능 문구:\n` + 각 줄 앞에 `- [link id] `

- [ ] **Step 1: 실패하는 테스트** — `'metrics 파일 링크는 제외'`, `'현재 연결표 기준 프롬프트 링크 수와 일치'`(`HUMANIZE_RULE_LINKS.filter(file===BLOG_PROMPT_FILE).length`), `'prefix 에 블로그 편집 가능 문구가 들어간다'`(input spec).
- [ ] **Step 2~4:** 실패 확인 → 구현 → `pnpm test -- blog-editable-surface humanize-research-input` PASS.

### Task 9: 게이트 1~6

**Files:**
- Create: `src/agent/humanize-research/domain/proposal-gate.ts`
- Test: `src/agent/humanize-research/domain/proposal-gate.spec.ts`
- Modify: `humanize-research.type.ts` (`ProposalSkipReason` 에 `EVIDENCE_SOURCE_MISMATCH`, `FILE_NOT_ALLOWED`, `MATCH_NOT_UNIQUE`, `OUTSIDE_EDITABLE_SURFACE`, `DELETE_NOT_ALLOWED`, `PROTECTED_ASSET`, `RULEBOOK_TOO_LONG` 추가)

**Interfaces:**
- Produces:
  - `interface GateContext { included: readonly CollectedItem[]; quickRules: string; blogEditableTexts: readonly string[] }`
  - `gateProposal({ proposal, context }: { proposal: HumanizeResearchProposal; context: GateContext }): ProposalSkipReason | null`
  - `PROTECTED_QUICK_RULE_MARKERS = ['**근거 등급과 강도:**', '**보존 신호 (지우지 말 것):**', '| B-1 |', '| B-2 |', '8. **보존 신호 유지**', '## 등급 기준']`
  - `QUICK_RULES_LINE_HEADROOM = 20`

판정 순서(첫 실패를 반환):
1. canon 근거가 UPSTREAM·CANON_LOG·ARXIV 를 하나도 포함하지 않으면, 또는 blog 근거가 BLOG·HUMANIZER 를 하나도 포함하지 않으면 `EVIDENCE_SOURCE_MISMATCH`
2. canon 인데 file ≠ `references/quick-rules.md`, 또는 blog 인데 file ≠ `BLOG_PROMPT_FILE` → `FILE_NOT_ALLOWED`
3. canon: `quickRules` 안 `oldString` 등장 수 ≠ 1 → `MATCH_NOT_UNIQUE`. blog: 어떤 편집 가능 문구에도 포함되지 않으면 `OUTSIDE_EDITABLE_SURFACE`, 전체 편집 가능 문구에서 등장 수 ≠ 1 이면 `MATCH_NOT_UNIQUE`
4. `newString === ''` 인데 (blog 이거나) `oldString.trim()` 이 `/^\| [A-Z]-\d+ \|[^\n]*\|$/u` 가 아니면 → `DELETE_NOT_ALLOWED`
5. canon: `oldString` 에 마커가 들어 있으면 → `PROTECTED_ASSET`
6. canon: 치환 후 줄 수 > 현재 줄 수 + 20 → `RULEBOOK_TOO_LONG`

- [ ] **Step 1: 실패하는 테스트** — 사유 코드마다 통과 1건·실패 1건. 추가로 다음 두 건을 넣는다.
  - `'삭제 표 행은 끝 개행이 있든 없든 통과'` (Review Focus 4)
  - `'11-16 실제 제안(자체검증 6번 문구, upstream 근거)은 통과'` — oldString `'6. **인공 표현 자제**: 원문에 없던 비유·수사·문학적 표현을 윤문 과정에서 임의로 추가하지 않았는가'`
- [ ] **Step 2~4:** 실패 확인 → 구현 → `pnpm test -- proposal-gate` PASS.

### Task 10: 유스케이스·포매터 연결

**Files:**
- Modify: `application/run-humanize-research.usecase.ts` (`buildOutput` 에서 `constrainResearchProposals` 뒤 `gateProposal` 적용, 실패는 `skipped`), `domain/humanize-research-output.ts` (상한 판정은 게이트 통과분 기준)
- Modify: `src/slack/format/humanize-research.formatter.ts` (+spec): 새 사유 라벨, 제안별 `[정본]`/`[블로그]` 표시, `enforcementGaps` 절 `집행 안 되는 규칙: <ruleId> (근거 N건)`
- Test: usecase spec, formatter spec

- [ ] **Step 1: 실패하는 테스트** — usecase `'게이트 실패 제안은 skipped 에 사유와 함께'`, formatter `'enforcementGaps 가 있으면 절이 나온다'`, `'새 사유 코드 7종 라벨 누락 없음'`(enum 순회).
- [ ] **Step 2~4:** 실패 확인 → 구현 → `pnpm test -- humanize-research` PASS.
- [ ] **Step 5: PR2 게이트** — `pnpm verify` → exit 0.
- [ ] **Step 6: Commit (사용자 요청 시에만)** — `feat(humanize-research): 블로그·정본 제안과 결정적 게이트를 넣는다`

---

## PR3 — 정본 검사·승인 카드·PR 반영

### Task 11: 게이트 7 — 정본 임시 worktree 검사

**Files:**
- Create: `src/agent/humanize-research/infrastructure/canon-check.runner.ts`
- Test: `src/agent/humanize-research/infrastructure/canon-check.runner.spec.ts`
- Modify: `humanize-research.type.ts` (`ProposalSkipReason` 에 `SELFCHECK_FAILED`, `SEVERITY_SYNC_FAILED`, `GOLDEN_FAILED`)

**Interfaces:**
- Consumes: `runGit`, `resolveHumanizeRulesRepoPath`
- Produces:
  - `interface CanonCheckResult { reason: ProposalSkipReason | null; baseSha: string }`
  - `CanonCheckRunner.check(proposal: HumanizeResearchProposal): Promise<CanonCheckResult>`
  - `CANON_GOLDEN_EXPECTED = [0, 2, 0, 1]`

- [ ] **Step 1: 실패하는 테스트**(spawn·runGit 을 mock) — `'selfcheck exit≠0 → SELFCHECK_FAILED'`, `'golden 종료 코드가 0 2 0 1 이 아니면 GOLDEN_FAILED'`, `'성공·실패 모두 worktree remove 를 부른다'`, `'baseSha 는 fetch 뒤 origin/main 의 rev-parse 값'`.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현한다.**
  - 순서: `git fetch origin` → `rev-parse origin/main` → `fs.mkdtemp(os.tmpdir()/humanize-canon-)` → `worktree add --detach <dir> origin/main` → `references/quick-rules.md` 에 정확 치환 → 검사 실행 → `finally` 에서 `worktree remove --force <dir>`.
  - 검사 명령(`cwd: <dir>`, shell 없이, 각 60초 타임아웃):
    - `python3 references/metrics_v2.py --selfcheck`
    - `python3 scripts/check_severity_sync.py`
    - `tests/golden/fixtures/*/` 마다 `good`·`bad`: `python3 scripts/verify_gates.py --before <f>/input.txt --after <f>/<o>_output.txt --genre essay`
- [ ] **Step 4: 통과 확인** — `pnpm test -- canon-check` PASS.

### Task 12: Preview kind `HUMANIZE_RULE_PR` 와 applier

**Files:**
- Modify: `src/preview-gate/domain/preview-action.type.ts` (`HUMANIZE_RULE_PR` + 주석으로 payload 형태)
- Create: `src/agent/humanize-research/domain/humanize-rule-pr.type.ts` (payload 타입 + `isHumanizeRulePrPayload`)
- Create: `src/agent/humanize-research/infrastructure/humanize-rule-pr.applier.ts`
- Test: `src/agent/humanize-research/infrastructure/humanize-rule-pr.applier.spec.ts`
- Modify: `src/app.module.ts` (`PreviewGateModule.forRoot` 의 `appliers` 와 `imports`)
- Modify: `src/console/application/console-mappers.ts` (kind 라벨이 exhaustive 면 추가)

**Interfaces:**
- Consumes: `GithubClientPort.getFileFromBranch`, `pushBranchAndOpenPr`, Task 11 `CanonCheckRunner.check`, Task 8 `BLOG_PROMPT_FILE`
- Produces:
  - `interface HumanizeRulePrPayload { target: ProposalTarget; repo: string; baseBranch: 'main'; baseSha: string; file: string; oldString: string; newString: string; linkId: string | null; rationale: string; targetMetric: string; evidenceExcerpts: string[]; linkedBlogText: string | null }`
  - `CANON_REPO = 'JSL107/humanize-korean'`, `BLOG_REPO = 'JSL107/personal_agents'`
  - 브랜치명 `humanize-rule/<previewId>`

- [ ] **Step 1: 실패하는 테스트**
  - `'대상 파일에서 oldString 이 1회가 아니면 PR 을 열지 않고 STALE_PROPOSAL 메시지로 throw'`
  - `'content 가 없으면 본문을 못 받았다는 메시지로 throw'` (Review Focus 5)
  - `'canon 은 승인 시 CanonCheckRunner 를 다시 돌리고 실패하면 throw'`
  - `'blog 는 프롬프트 파일과 humanize-rule-links.ts 두 파일을 한 커밋으로'` — 연결표 파일에서도 같은 `oldString` 을 정확 치환한다. 거기서 1회가 아니면 throw.
  - `'성공 시 artifacts 에 github_pr'` (GithubPrVerifier 가 재확인)
  - `'resumable 은 정의하지 않는다'`
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현한다.** `DocsAuditPrApplier` 와 같은 모양이다. PR 본문에는 targetMetric·rationale·근거 발췌·(canon 이고 `linkedBlogText` 가 있으면) `블로그 쪽 미반영: <문구>` 를 넣는다. 담당자는 JSL107 이다(`pushBranchAndOpenPr` 가 지정하지 않으면 PR 생성 직후 기존 assignee 지정 메서드를 부른다. 없으면 PR 본문에 적고 보고한다).
- [ ] **Step 4: 통과 확인** — `pnpm test -- humanize-rule-pr` PASS, 이어서 `pnpm build && node --env-file=.env scripts/check-di.cjs` green.

### Task 13: 회차에서 카드 만들기 + 스위치

**Files:**
- Modify: `application/run-humanize-research.usecase.ts` (canon 제안은 게이트 1~6 통과 뒤 `CanonCheckRunner.check`. 실패는 skipped, 통과는 `baseSha` 를 결과에 싣는다)
- Modify: `humanize-research.type.ts` (`GatedProposal = HumanizeResearchProposal & { baseSha: string | null }`, `HumanizeResearchOutput.proposals: GatedProposal[]`)
- Modify: `src/autopilot/infrastructure/tasks/humanize-research.autopilot-task.ts` (+spec): `HUMANIZE_RULE_PR_ENABLED === 'true'` 이면 제안마다 `previews[]` 를 만든다
- Modify: `src/autopilot/domain/autopilot.playbook.ts:307` (`riskTier: 'T1_PREVIEW'`)
- Modify: `src/config/app.config.ts`, `.env.example`, `.env`, README (env 표) — `HUMANIZE_RULE_PR_ENABLED`(기본 미설정 = off)
- Run: `pnpm docs:sync`

**Interfaces:**
- Consumes: Task 11 `CanonCheckResult`, Task 12 `HumanizeRulePrPayload`, `AutopilotPreviewRequest`
- Produces: `buildHumanizeRulePreview({ proposal, included }): AutopilotPreviewRequest` (태스크 파일 내부)

- [ ] **Step 1: 실패하는 테스트**
  - task: `'스위치 off 면 previews 없음'`, `'on 이면 제안 수만큼 previews'`.
  - task: `'previewText 에 전후 문구 전문과 근거 발췌'` — 120자 절단이 없고, 근거 발췌는 항목당 600자 이하다.
  - task: `'blog 제안의 baseSha 는 null, 카드는 그대로 생성'`(blog 재검증은 applier 의 GitHub 조회가 맡는다).
  - usecase: `'canon 게이트 7 실패는 skipped(SELFCHECK_FAILED 등)'`.
- [ ] **Step 2: 실패 확인** → FAIL.
- [ ] **Step 3: 구현한다.** `blog` 의 `linkId` 는 `oldString` 을 포함하는 연결표 항목 id 다. `linkedBlogText` 는 canon 대상 행의 규칙 id(`| X-n |`)와 같은 `ruleId` 를 가진 연결표 항목의 `local.text` 이고, 없으면 `null` 이다.
- [ ] **Step 4: 통과 확인** — `pnpm test -- humanize-research` PASS.
- [ ] **Step 5: PR3 게이트** — `pnpm verify` → exit 0, `pnpm docs:check` → exit 0.
- [ ] **Step 6: 실제 확인** — 로컬 앱(포트 3099 운영 인스턴스가 아닌 개발 인스턴스)에서 `HUMANIZE_RULE_PR_ENABLED=true` 로 회차를 수동 실행한다. 카드가 뜨는지 확인하되 **승인 버튼은 누르지 않는다**(외부 PR 생성은 사용자 승인 사항). 결과를 검증 노트 초안으로 정리한다.
- [ ] **Step 7: Commit (사용자 요청 시에만)** — `feat(humanize-research): 규칙 제안을 승인 카드로 PR 까지 잇는다`
