# Daily Eval PR 평가 + careerLog Notion DB 적재 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 19:00 Daily Eval(cron)이 오늘 머지된 본인 PR을 평가 근거로 합성하고, careerLog를 하루 1행으로 Notion DB에 자동 upsert한다.

**Architecture:** 기존 `GeneratePoEvaluationUsecase`(range=TODAY)에 `GithubClientPort.listAuthorMergedPullRequestsSince`로 오늘 머지 PR을 추가 수집해 LLM 합성 입력에 넣고, LLM 출력에 `mergedPrReview`(PR 평가)를 추가한다. 결과는 `PoEvalAutopilotTask` 내부에서 신규 `CareerLogDbApplier`가 기존 `findOrCreateDailyPage`(title=날짜) + `updatePageProperties`로 DB 행을 upsert한다. careerLog 구조(schemaVersion=1)와 pr-careerlog webhook 경로는 건드리지 않는다.

**Tech Stack:** NestJS 10, TypeScript, @notionhq/client, @octokit/rest, Jest. 설계: [docs/superpowers/specs/2026-06-25-daily-eval-pr-careerlog-db-design.md](../specs/2026-06-25-daily-eval-pr-careerlog-db-design.md).

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` (npm/yarn 금지). 검증: `pnpm lint:check && pnpm test && pnpm build` 3중 green.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`. ORM은 Prisma만.
- careerLog `schemaVersion` 은 1 유지 — PR 평가는 careerLog 밖 `mergedPrReview` 로 분리.
- 새 `NotionClientPort` 메서드 추가 금지 — 기존 `findOrCreateDailyPage` + `updatePageProperties` 재사용.
- `pr-careerlog`, 수동 `/po-eval` 페이지 경로(`CAREER_LOG_NOTION_PAGE_ID`)는 수정 금지.
- 변수명 줄임말 금지(`error`/`found`/`repository`), `if` 단일라인 중괄호 필수, try 안 `return await`.
- 커밋: 의미 단위 atomic. 형식 `<type>(<scope>): <subject>`. 끝에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `mergedPrReview` LLM 출력 계약 (타입 + 파서 + 시스템 프롬프트)

**Files:**
- Modify: `src/agent/po-eval/domain/po-eval.type.ts`
- Modify: `src/agent/po-eval/domain/prompt/evaluation.parser.ts`
- Modify: `src/agent/po-eval/domain/prompt/po-eval-system.prompt.ts`
- Test: `src/agent/po-eval/domain/prompt/evaluation.parser.spec.ts` (기존)

**Interfaces:**
- Produces: `EvaluationOutput.mergedPrReview?: MergedPrReview` 와 타입:
  ```ts
  export interface MergedPrEvaluation {
    prNumber: number;
    ref: string;        // "owner/repo#N"
    title: string;
    url: string;
    additions: number;
    deletions: number;
    evaluation: string; // LLM 평가 1~2문장
  }
  export interface MergedPrReview {
    overall: string;
    prs: MergedPrEvaluation[];
  }
  ```
- LLM 출력 계약: LLM은 `mergedPrReview: { overall: string, prs: { prNumber: number, evaluation: string }[] }` 만 생성. ref/title/url/additions/deletions 는 usecase(Task 2)가 채운다. → 파서는 `prNumber`+`evaluation`+`overall` 만 파싱.
- Consumes: 없음.

- [ ] **Step 1: 타입 추가 — `po-eval.type.ts`**

`EvaluationOutput` 인터페이스 끝(impact 다음 닫는 중괄호 뒤)에 `mergedPrReview?` 추가하고, 파일 끝에 두 인터페이스를 추가한다.
```ts
export interface EvaluationOutput {
  range: AgentRunRange;
  sourceAgentRuns: SubAgentRunRefs;
  qualitative: { summary: string; blockers: string[]; wins: string[] };
  careerLog: { /* 기존 그대로, schemaVersion 1 유지 */ };
  // 신규 — range=TODAY 에서 오늘 머지 PR 이 있을 때만. 없으면 undefined.
  mergedPrReview?: MergedPrReview;
}

export interface MergedPrEvaluation {
  prNumber: number;
  ref: string;
  title: string;
  url: string;
  additions: number;
  deletions: number;
  evaluation: string;
}
export interface MergedPrReview {
  overall: string;
  prs: MergedPrEvaluation[];
}
```

- [ ] **Step 2: 파서 LLM 부분 타입 정의 — `evaluation.parser.ts`**

LLM이 반환하는 PR 평가 부분만 받는 타입 + `EvaluationLlmOutput` 확장.
```ts
// LLM 은 prNumber + evaluation 만 생성 (메타는 usecase 가 join).
export interface LlmMergedPrReview {
  overall: string;
  prs: { prNumber: number; evaluation: string }[];
}
export type EvaluationLlmOutput = Pick<EvaluationOutput, 'qualitative' | 'careerLog'> & {
  mergedPrReview?: LlmMergedPrReview;
};
```

- [ ] **Step 3: 실패 테스트 작성 — `evaluation.parser.spec.ts`**

기존 spec에 케이스 추가. (a) `mergedPrReview` 있는 JSON → overall + prs(prNumber/evaluation) 파싱. (b) `mergedPrReview` 누락 → undefined. (c) `prs` 항목 중 prNumber 가 number 아님 → 해당 항목 제외(나머지 유지).
```ts
it('mergedPrReview 를 파싱한다', () => {
  const raw = JSON.stringify({
    qualitative: { summary: 's', blockers: [], wins: [] },
    careerLog: { schemaVersion: 1, period: '2026-06-24', achievements: { quantitative: [], qualitative: [] }, technologies: [], impact: 'i' },
    mergedPrReview: { overall: '전반', prs: [{ prNumber: 110, evaluation: '평가' }] },
  });
  const out = parseEvaluationOutput(raw);
  expect(out.mergedPrReview).toEqual({ overall: '전반', prs: [{ prNumber: 110, evaluation: '평가' }] });
});

it('mergedPrReview 가 없으면 undefined', () => {
  const raw = JSON.stringify({
    qualitative: { summary: 's', blockers: [], wins: [] },
    careerLog: { schemaVersion: 1, period: '2026-W22', achievements: { quantitative: [], qualitative: [] }, technologies: [], impact: 'i' },
  });
  expect(parseEvaluationOutput(raw).mergedPrReview).toBeUndefined();
});

it('prs 의 잘못된 항목(prNumber 비숫자)은 제외한다', () => {
  const raw = JSON.stringify({
    qualitative: { summary: 's', blockers: [], wins: [] },
    careerLog: { schemaVersion: 1, period: '2026-06-24', achievements: { quantitative: [], qualitative: [] }, technologies: [], impact: 'i' },
    mergedPrReview: { overall: 'o', prs: [{ prNumber: 'x', evaluation: 'a' }, { prNumber: 7, evaluation: 'b' }] },
  });
  expect(parseEvaluationOutput(raw).mergedPrReview?.prs).toEqual([{ prNumber: 7, evaluation: 'b' }]);
});
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm jest src/agent/po-eval/domain/prompt/evaluation.parser.spec.ts`
Expected: FAIL (mergedPrReview 파싱 미구현).

- [ ] **Step 5: 파서 구현 — `evaluation.parser.ts`**

`parseEvaluationOutput` 의 return 객체에 `mergedPrReview: parseMergedPrReview(root.mergedPrReview)` 추가하고 헬퍼 작성.
```ts
const parseMergedPrReview = (raw: unknown): LlmMergedPrReview | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const overall = typeof obj.overall === 'string' ? obj.overall : '';
  const prsRaw = Array.isArray(obj.prs) ? obj.prs : [];
  const prs = prsRaw
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .filter((item) => typeof item.prNumber === 'number' && typeof item.evaluation === 'string')
    .map((item) => ({ prNumber: item.prNumber as number, evaluation: item.evaluation as string }));
  if (overall.length === 0 && prs.length === 0) {
    return undefined;
  }
  return { overall, prs };
};
```

- [ ] **Step 6: 시스템 프롬프트 확장 — `po-eval-system.prompt.ts`**

출력 schema 설명에 mergedPrReview 추가 + 규칙. 출력 JSON 예시 객체에 `mergedPrReview` 키 추가.
```
- mergedPrReview (선택): 사용자 prompt 에 [오늘 머지 PR] 섹션이 있을 때만 생성. 없으면 키 자체를 생략.
  - mergedPrReview.overall: 오늘 머지 PR 전반에 대한 평가 1~2문장.
  - mergedPrReview.prs[].prNumber: 입력에 제시된 PR 번호 그대로 (입력에 없는 번호 생성 금지).
  - mergedPrReview.prs[].evaluation: 그 PR 의 기술적 난이도·의미·임팩트 1~2문장.
```
JSON 예시에 추가:
```jsonc
  "mergedPrReview": { "overall": string, "prs": [ { "prNumber": number, "evaluation": string } ] }
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm jest src/agent/po-eval/domain/prompt/evaluation.parser.spec.ts`
Expected: PASS.

- [ ] **Step 8: 커밋**
```bash
git add src/agent/po-eval/domain/po-eval.type.ts src/agent/po-eval/domain/prompt/evaluation.parser.ts src/agent/po-eval/domain/prompt/po-eval-system.prompt.ts src/agent/po-eval/domain/prompt/evaluation.parser.spec.ts
git commit -m "feat(po-eval): mergedPrReview LLM 출력 계약 추가 (PR 평가 파싱)"
```

---

### Task 2: usecase — 오늘 머지 PR 수집 + 프롬프트 주입 + 메타 join

**Files:**
- Modify: `src/agent/po-eval/application/generate-po-evaluation.usecase.ts`
- Test: `src/agent/po-eval/application/generate-po-evaluation.usecase.spec.ts` (기존)

**Interfaces:**
- Consumes: `EvaluationLlmOutput.mergedPrReview`(Task 1), `GithubClientPort.listAuthorMergedPullRequestsSince` (`{repo, author, sinceIsoDate, limit}` → `GithubPullRequestSummary[]`), `getTodayKstDate()`.
- Produces: `EvaluationOutput.mergedPrReview` (LLM evaluation 을 PR 메타와 prNumber 로 join).

- [ ] **Step 1: 생성자 의존성 추가**

`@Inject(GITHUB_CLIENT_PORT) private readonly githubClient: GithubClientPort` + `private readonly configService: ConfigService` 주입. import 추가(github-client.port, ConfigService, GithubPullRequestSummary, getTodayKstDate).
상수: `const MERGED_PR_LIMIT = 20;`, `const PR_BODY_MAX_BYTES = 1_500;`.

- [ ] **Step 2: PR 수집 메서드 작성**

range=TODAY 일 때만, author env 있을 때만 수집. `getTodayKstDate()` 를 since 로, 결과를 mergedAt 의 KST 날짜 == 오늘 인 것만 2차 필터.
```ts
private async collectTodayMergedPrs(range: AgentRunRange): Promise<GithubPullRequestSummary[]> {
  if (range !== 'TODAY') {
    return [];
  }
  const author = this.configService.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
  if (!author || author.trim().length === 0) {
    return [];
  }
  const repoEnv = this.configService.get<string>('IMPACT_REPORT_GITHUB_REPO');
  const repo = repoEnv && repoEnv.trim().length > 0 ? repoEnv : null;
  const today = getTodayKstDate();
  try {
    const summaries = await this.githubClient.listAuthorMergedPullRequestsSince({ repo, author, sinceIsoDate: today, limit: MERGED_PR_LIMIT });
    return summaries.filter((summary) => toKstDate(summary.mergedAt) === today);
  } catch (error: unknown) {
    this.logger.warn(`오늘 머지 PR 조회 실패 (PR 평가 생략): ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}
```
`toKstDate` 헬퍼(파일 하단): `mergedAt`(ISO, null 가능)을 `Asia/Seoul` 날짜(YYYY-MM-DD)로. null이면 빈 문자열.
```ts
const toKstDate = (iso: string | null): string => {
  if (!iso) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
};
```

- [ ] **Step 3: execute()에 수집 + prompt 주입 + join 배선**

`collectSnapshots` 후 `const mergedPrs = await this.collectTodayMergedPrs(range);`. `buildPrompt({ snapshots, range, mergedPrs })` 로 PR 섹션 전달(Step 5). run() 안 partial 처리 뒤:
```ts
const output: EvaluationOutput = {
  range,
  sourceAgentRuns: refs,
  qualitative: partial.qualitative,
  careerLog: partial.careerLog,
  mergedPrReview: joinMergedPrReview(partial.mergedPrReview, mergedPrs),
};
```

- [ ] **Step 4: join 헬퍼 작성 (파일 하단)**

LLM evaluation 을 PR 메타와 prNumber 로 join. PR 메타가 source-of-truth. evaluation 없는 PR은 빈 문자열, LLM이 만든 미존재 prNumber는 버림.
```ts
const joinMergedPrReview = (
  llm: LlmMergedPrReview | undefined,
  prs: GithubPullRequestSummary[],
): MergedPrReview | undefined => {
  if (prs.length === 0) {
    return undefined;
  }
  const evalByNumber = new Map<number, string>();
  for (const item of llm?.prs ?? []) {
    evalByNumber.set(item.prNumber, item.evaluation);
  }
  const joined: MergedPrEvaluation[] = prs.map((pr) => ({
    prNumber: pr.number,
    ref: `${pr.repo}#${pr.number}`,
    title: pr.title,
    url: pr.url,
    additions: pr.additions,
    deletions: pr.deletions,
    evaluation: evalByNumber.get(pr.number) ?? '',
  }));
  return { overall: llm?.overall ?? '', prs: joined };
};
```

- [ ] **Step 5: `buildPrompt` 에 PR 섹션 추가**

`buildPrompt` 시그니처에 `mergedPrs: GithubPullRequestSummary[]` 추가. snapshot 섹션 뒤, [합성 지시] 앞에 PR 섹션 push(있을 때만). body는 PR_BODY_MAX_BYTES로 truncate(기존 truncateUtf8 재사용).
```ts
if (mergedPrs.length > 0) {
  lines.push('[오늘 머지 PR] (이 PR 들을 평가해 mergedPrReview 로 출력)');
  mergedPrs.forEach((pr) => {
    lines.push(`- #${pr.number} ${pr.repo}#${pr.number} — ${pr.title} (+${pr.additions}/-${pr.deletions}, ${pr.changedFilesCount} files)`);
    const body = truncateUtf8(pr.body.trim(), PR_BODY_MAX_BYTES);
    if (body.length > 0) {
      lines.push(`  본문: ${body}`);
    }
  });
  lines.push('');
}
```
합성 지시 문구에 "[오늘 머지 PR] 이 있으면 각 PR 을 평가해 mergedPrReview 로 출력" 추가.

- [ ] **Step 6: spec 테스트 작성/갱신**

기존 spec의 mock GithubClientPort 추가(없으면). 케이스: (a) range=TODAY + author env + PR 2건 → listAuthorMergedPullRequestsSince 호출 + output.mergedPrReview.prs 2건(prNumber join). (b) range=WEEK → GitHub 호출 안 함, mergedPrReview undefined. (c) author env 미설정 → 호출 안 함, undefined. (d) GitHub throw → mergedPrReview undefined(회고는 정상). (e) mergedAt이 어제(KST)인 PR은 2차 필터로 제외.

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm jest src/agent/po-eval/application/generate-po-evaluation.usecase.spec.ts`
Expected: PASS.

- [ ] **Step 8: 커밋**
```bash
git add src/agent/po-eval/application/generate-po-evaluation.usecase.ts src/agent/po-eval/application/generate-po-evaluation.usecase.spec.ts
git commit -m "feat(po-eval): TODAY range 에서 오늘 머지 PR 수집·평가 합성"
```

---

### Task 3: careerLog DB Applier (Notion DB upsert)

**Files:**
- Create: `src/agent/po-eval/infrastructure/career-log-db.properties.ts`
- Create: `src/agent/po-eval/infrastructure/career-log-db.applier.ts`
- Test: `src/agent/po-eval/infrastructure/career-log-db.applier.spec.ts`

**Interfaces:**
- Consumes: `EvaluationOutput`(Task 1), `NotionClientPort.findOrCreateDailyPage` + `updatePageProperties`.
- Produces: `CareerLogDbApplier.upsert({ databaseId, output, modelLabel, agentRunId }): Promise<void>`.

DB 속성명 상수(사용자가 Notion DB에 만들 속성명과 정확히 일치 — §5.5):
```ts
export const CAREER_LOG_DB_PROP = {
  date: 'Date', quantitative: '정량 성과', qualitative: '정성 성과',
  technologies: '기술 스택', impact: 'Impact', wins: 'Wins', blockers: 'Blockers',
  mergedPr: '머지 PR', prReview: 'PR 평가', source: 'Source', modelRun: 'Model/Run',
} as const;
```

- [ ] **Step 1: properties 빌더 + 실패 테스트**

`career-log-db.properties.ts`: `buildCareerLogDbProperties(output, modelLabel, agentRunId): Record<string, unknown>`. blog-publish-properties 패턴(rich_text/multi_select/date). Date(title)는 findOrCreateDailyPage가 생성하므로 properties엔 **포함 안 함**(title은 upsert 키). 빈 필드는 생략.
테스트 `career-log-db.applier.spec.ts`(빌더 단위): quantitative join `\n`, technologies multi_select, mergedPrReview 있을 때 머지PR/PR평가 rich_text, source = formatSource(refs).
```ts
// 핵심 매핑
properties[P.quantitative] = richText(cl.achievements.quantitative.join('\n'));   // 빈 배열이면 생략
properties[P.technologies] = { multi_select: cl.technologies.map((name) => ({ name })) }; // 빈 배열이면 생략
properties[P.impact] = richText(cl.impact);
properties[P.source] = richText(formatSourceLine(output.sourceAgentRuns)); // "workReviewer=#18 · missing: ..."
properties[P.modelRun] = richText(`${modelLabel} · run #${agentRunId}`);
if (output.mergedPrReview) {
  properties[P.mergedPr] = richText(output.mergedPrReview.prs.map((pr) => `${pr.ref} — ${pr.title} (${pr.url})`).join('\n'));
  properties[P.prReview] = richText([output.mergedPrReview.overall, ...output.mergedPrReview.prs.map((pr) => `#${pr.prNumber}: ${pr.evaluation}`)].filter((line) => line.trim().length > 0).join('\n'));
}
```
`richText(text)` 헬퍼: text 비면 undefined 반환 → 호출부에서 truthy일 때만 set. Notion rich_text 2000자 cap 고려해 `text.slice(0, 2000)`.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm jest src/agent/po-eval/infrastructure/career-log-db.applier.spec.ts`
Expected: FAIL.

- [ ] **Step 3: applier 구현 — `career-log-db.applier.ts`**
```ts
@Injectable()
export class CareerLogDbApplier {
  private readonly logger = new Logger(CareerLogDbApplier.name);
  constructor(@Inject(NOTION_CLIENT_PORT) private readonly notionClient: NotionClientPort) {}

  async upsert({ databaseId, output, modelLabel, agentRunId }: {
    databaseId: string; output: EvaluationOutput; modelLabel: string; agentRunId: number;
  }): Promise<void> {
    const period = output.careerLog.period;
    const row = await this.notionClient.findOrCreateDailyPage({ databaseId, title: period });
    const properties = buildCareerLogDbProperties(output, modelLabel, agentRunId);
    await this.notionClient.updatePageProperties({ pageId: row.pageId, properties });
    this.logger.log(`careerLog DB upsert — databaseId=${databaseId} period=${period} pageId=${row.pageId}`);
  }
}
```

- [ ] **Step 4: applier 동작 테스트 추가**

mock NotionClientPort: findOrCreateDailyPage가 {pageId,url} 반환 → updatePageProperties가 그 pageId + buildCareerLogDbProperties 결과로 호출되는지. period가 title로 전달되는지.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm jest src/agent/po-eval/infrastructure/career-log-db.applier.spec.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**
```bash
git add src/agent/po-eval/infrastructure/career-log-db.properties.ts src/agent/po-eval/infrastructure/career-log-db.applier.ts src/agent/po-eval/infrastructure/career-log-db.applier.spec.ts
git commit -m "feat(po-eval): careerLog Notion DB upsert applier (findOrCreateDailyPage+updateProperties 재사용)"
```

---

### Task 4: Slack formatter — PR 평가 섹션

**Files:**
- Modify: `src/slack/format/po-evaluation.formatter.ts`
- Test: `src/slack/format/po-evaluation.formatter.spec.ts` (없으면 생성)

**Interfaces:**
- Consumes: `EvaluationOutput.mergedPrReview`(Task 1).

- [ ] **Step 1: 실패 테스트 작성**

(a) mergedPrReview 있으면 "🔀 오늘 머지 PR 평가" + PR별 라인 + overall 포함. (b) undefined면 섹션 미포함(기존과 동일). escape 적용.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm jest src/slack/format/po-evaluation.formatter.spec.ts`
Expected: FAIL.

- [ ] **Step 3: 구현 — careerLog 섹션과 source footer 사이에 삽입**
```ts
if (output.mergedPrReview && output.mergedPrReview.prs.length > 0) {
  lines.push('');
  lines.push('*🔀 오늘 머지 PR 평가*');
  for (const pr of output.mergedPrReview.prs) {
    const evalText = pr.evaluation.trim().length > 0 ? ` — ${escapeSlackMrkdwn(pr.evaluation)}` : '';
    lines.push(`• #${pr.prNumber} ${escapeSlackMrkdwn(pr.title)}${evalText}`);
  }
  if (output.mergedPrReview.overall.trim().length > 0) {
    lines.push(`_${escapeSlackMrkdwn(output.mergedPrReview.overall)}_`);
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm jest src/slack/format/po-evaluation.formatter.spec.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**
```bash
git add src/slack/format/po-evaluation.formatter.ts src/slack/format/po-evaluation.formatter.spec.ts
git commit -m "feat(po-eval): 회고 메시지에 오늘 머지 PR 평가 섹션 추가"
```

---

### Task 5: autopilot task — DB 자동 적재 배선 (try/catch 격리)

**Files:**
- Modify: `src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts`
- Test: `src/autopilot/infrastructure/tasks/po-eval.autopilot-task.spec.ts` (기존)

**Interfaces:**
- Consumes: `CareerLogDbApplier.upsert`(Task 3), `GeneratePoEvaluationUsecase`(Task 2), `ConfigService`.

- [ ] **Step 1: 생성자에 applier + ConfigService 주입**

`constructor(private readonly generatePoEvaluation, private readonly careerLogDbApplier: CareerLogDbApplier, private readonly configService: ConfigService)`.

- [ ] **Step 2: run() 성공 경로에 DB 적재 추가 (throw 안 함)**

`outcome` 획득 후, slackText 만들기 전/후 무관하게:
```ts
const databaseId = this.configService.get<string>('CAREER_LOG_NOTION_DB_ID')?.trim();
if (databaseId && databaseId.length > 0) {
  try {
    await this.careerLogDbApplier.upsert({ databaseId, output: outcome.result, modelLabel: outcome.modelUsed, agentRunId: outcome.agentRunId });
  } catch (error) {
    // 적재 실패가 회고 발송을 막지 않도록 격리 (orchestrator 의 task 실패 격리는 회고를 ⚠️로 대체하므로 여기서 swallow).
    this.logger.warn(`careerLog DB 적재 실패 (회고는 발송): ${error instanceof Error ? error.message : String(error)}`);
  }
}
```
(클래스에 `private readonly logger = new Logger(PoEvalAutopilotTask.name);` 추가.)

- [ ] **Step 3: spec 갱신**

mock CareerLogDbApplier + ConfigService. 케이스: (a) CAREER_LOG_NOTION_DB_ID 설정 → upsert 호출 + slackText 정상 반환. (b) 미설정 → upsert 미호출 + slackText 정상. (c) upsert throw → slackText 정상 반환(throw 안 함) + warn. NO_SUB_AGENT_RUNS skip 경로는 기존대로.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm jest src/autopilot/infrastructure/tasks/po-eval.autopilot-task.spec.ts`
Expected: PASS.

- [ ] **Step 5: 커밋**
```bash
git add src/autopilot/infrastructure/tasks/po-eval.autopilot-task.ts src/autopilot/infrastructure/tasks/po-eval.autopilot-task.spec.ts
git commit -m "feat(autopilot): Daily Eval careerLog Notion DB 자동 적재 배선 (적재 실패 격리)"
```

---

### Task 6: 모듈 와이어링 + env (4곳 동기)

**Files:**
- Modify: `src/agent/po-eval/po-eval.module.ts`
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `CareerLogDbApplier`(Task 3), `GithubModule`/`NotionModule` (PORT export 확인됨).

- [ ] **Step 1: PoEvalModule 배선**

`imports` 에 `GithubModule`, `NotionModule` 추가. `providers`/`exports` 에 `CareerLogDbApplier` 추가.
(GeneratePoEvaluationUsecase 가 GITHUB_CLIENT_PORT, CareerLogDbApplier 가 NOTION_CLIENT_PORT 를 주입받기 위함. AutopilotModule 은 PoEvalModule 만 import 하므로 추가 import 불필요.)
```ts
imports: [ModelRouterModule, AgentRunModule, GithubModule, NotionModule],
providers: [GeneratePoEvaluationUsecase, PoEvalDispatcher, CareerLogDbApplier],
exports: [GeneratePoEvaluationUsecase, PoEvalDispatcher, CareerLogDbApplier],
```

- [ ] **Step 2: app.config.ts env 추가**

`CAREER_LOG_NOTION_PAGE_ID` 정의 바로 아래에:
```ts
// Daily Eval(cron) careerLog 자동 적재 대상 Notion Database id (하루 1행 upsert).
// 미설정 시 Daily Eval 은 DB 적재를 skip (회고 Slack 은 그대로). 수동 /po-eval 페이지 경로와 별개.
@IsOptional()
@IsString()
CAREER_LOG_NOTION_DB_ID?: string;
```

- [ ] **Step 3: .env.example + README 추가**

`.env.example` 에 `CAREER_LOG_NOTION_DB_ID=` 한 줄(주석 포함). README의 env 표에 행 추가(설명: Daily Eval careerLog 자동 적재 Notion DB, 선택).

- [ ] **Step 4: 전체 검증 (3중 green)**

Run: `pnpm lint:check && pnpm test && pnpm build`
Expected: 모두 exit 0.

- [ ] **Step 5: 커밋**
```bash
git add src/agent/po-eval/po-eval.module.ts src/config/app.config.ts .env.example README.md
git commit -m "feat(po-eval): CareerLogDbApplier 모듈 배선 + CAREER_LOG_NOTION_DB_ID env"
```

---

## Self-Review

- **Spec coverage:** §5.1 PR 수집(Task 2), §5.2 mergedPrReview(Task 1·2), §5.3 formatter(Task 4), §5.4 applier(Task 3), §5.5 DB 스키마(Task 3 속성 상수), §5.6 env(Task 6), §4 task 내부 try/catch(Task 5). 모두 task 매핑됨.
- **Placeholder scan:** "handle edge cases" 류 없음 — 각 분기(PR 0건/author 미설정/throw/날짜 경계) 동작 명시.
- **Type consistency:** `MergedPrReview`/`MergedPrEvaluation`(Task 1) ↔ `joinMergedPrReview`(Task 2) ↔ `buildCareerLogDbProperties`(Task 3) ↔ formatter(Task 4) 필드명(prNumber/ref/title/url/evaluation/overall) 일관. `AgentRunOutcome` 필드 `modelUsed`/`agentRunId`/`result` 일관(Task 5).
- **확인 필요(구현 시):** DB title 속성명은 `resolveTitlePropertyName` 가 type='title' 자동 탐지하므로 상수 `Date` 는 매칭 키가 아닌 사용자 표기용 — 실제 매칭은 title 타입 기반(spec §8 해소).
