# 저녁 회고 → 발행 후보 파이프라인 (EVENING_RETRO_PUBLISH) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 19:00 KST evening 그룹에서 오늘 한 일을 회고해 "발행 후보 + 가치 점수"를 Slack으로 제안하고, PreviewGate 버튼 2장(블로그 / 경력)으로 블로그 Notion 발행·이력서/포트폴리오 반영을 승인 실행한다.

**Architecture:** 신규 autopilot task(`evening-retro-publish`)가 오늘 머지 PR(GitHub) + WORK_REVIEWER·PO_EVAL run(AgentRun)을 재조회해 codex(신규 `AgentType.EVENING_RETRO`)로 1회 회고→후보 JSON을 만든다. 결과는 요약 텍스트(다이제스트 합류)와 `previews[]`(카드 2장)로 반환하고, orchestrator가 PreviewGate pending을 생성해 버튼 카드를 발송한다. 승인 시 kind별 Applier가 블로그 본문 생성→Notion append, 경력=오늘 머지 PR 전체를 `ReflectPrUsecase`(다건 통합 회고)로 반영한다.

**Tech Stack:** NestJS 10, Prisma 6, BullMQ, Slack Bolt 4, codex CLI(ChatGPT) via ModelRouter, `@notionhq/client`, jest.

**Base:** main @ #134 (다건 PR 통합 회고 REFLECT_PR 포함 — `extractPrReferences`, `reflect-pr.usecase` 다건 분기 이미 존재).

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` 전용 (`npm`/`yarn` 금지).
- ORM은 Prisma만. `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- CLI provider 호출은 `ModelRouter.route(...)`만 사용(직접 spawn/argv 금지).
- 변수명 축약 금지(`error`/`found`/`repository`), `if`는 항상 중괄호, try-catch 내 `return await`.
- 완료 기준: `pnpm lint:check && pnpm test && pnpm build` 3중 exit 0.
- commit은 각 Task 끝에서만. atomic·한국어 OK, 형식 `<type>(<scope>): <subject>`.
- 신규 env 추가 시 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts` + README 표.
- 작업 디렉토리는 격리 worktree `.claude/worktrees/feat+evening-retro-publish`. **모든 경로는 반드시 이 worktree 기준**(메인 트리로 새면 변경이 유실됨).

---

### Task 1: 기반 enum — AgentType.EVENING_RETRO + PREVIEW_KIND 2개

**Files:**
- Modify: `src/model-router/domain/model-router.type.ts` (AgentType enum)
- Modify: `src/model-router/application/model-router.usecase.ts` (`AGENT_TO_PROVIDER`)
- Modify: `src/preview-gate/domain/preview-action.type.ts:28` (PREVIEW_KIND에 2개 추가)
- Test: `src/model-router/application/model-router.usecase.spec.ts` (기존 파일에 케이스 추가)

**Interfaces:**
- Produces: `AgentType.EVENING_RETRO = 'EVENING_RETRO'` (codex 라우팅), `PREVIEW_KIND.EVENING_BLOG_PUBLISH`, `PREVIEW_KIND.EVENING_CAREER_REFLECT`.

- [ ] **Step 1: `AGENT_TO_PROVIDER[EVENING_RETRO]` 매핑 테스트 추가**

`src/model-router/application/model-router.usecase.spec.ts`의 기존 매핑 테스트 블록에 추가:
```ts
it('EVENING_RETRO 는 ChatGPT(codex) 로 라우팅된다', () => {
  expect(AGENT_TO_PROVIDER[AgentType.EVENING_RETRO]).toBe(
    ModelProviderName.CHATGPT,
  );
});
```
(파일 상단 import에 `AGENT_TO_PROVIDER`/`ModelProviderName`/`AgentType`가 있는지 확인 후 재사용.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- model-router.usecase.spec`
Expected: FAIL — `EVENING_RETRO` 프로퍼티 없음.

- [ ] **Step 3: enum + 매핑 추가**

`src/model-router/domain/model-router.type.ts`의 `AgentType` enum 끝(BLOG 근처)에 추가:
```ts
  EVENING_RETRO = 'EVENING_RETRO',
```
`src/model-router/application/model-router.usecase.ts`의 `AGENT_TO_PROVIDER`에 추가(BLOG 항목 근처):
```ts
  // 저녁 회고→발행 후보 — codex 로 회고/후보 선별/블로그 본문 생성. BLOG(Hermes sentinel)와 달리 실제 route() 를 탄다.
  [AgentType.EVENING_RETRO]: ModelProviderName.CHATGPT,
```

- [ ] **Step 4: PREVIEW_KIND 2개 추가**

`src/preview-gate/domain/preview-action.type.ts`의 `PREVIEW_KIND` 객체 끝(`PREFERENCE_PROFILE` 다음)에 추가:
```ts
  // 저녁 회고 — 오늘 대표 작업을 codex 로 블로그 본문 생성 후 Notion 발행.
  // payload = { topPick:{title,keywords[]}, retroContext, slackUserId } (EveningBlogPublishApplier).
  EVENING_BLOG_PUBLISH: 'EVENING_BLOG_PUBLISH',
  // 저녁 회고 — 오늘 머지된 PR 전체를 다건 통합 회고로 이력서 프로필 편입 + 포트폴리오 Notion append.
  // payload = { prRefs:string[], slackUserId } (EveningCareerReflectApplier 가 ReflectPrUsecase 위임).
  EVENING_CAREER_REFLECT: 'EVENING_CAREER_REFLECT',
```

- [ ] **Step 5: 테스트 통과 + 타입 확인**

Run: `pnpm test -- model-router.usecase.spec && pnpm build`
Expected: PASS + build 성공(enum exhaustive 만족).

- [ ] **Step 6: Commit**

```bash
git add src/model-router/domain/model-router.type.ts src/model-router/application/model-router.usecase.ts src/model-router/application/model-router.usecase.spec.ts src/preview-gate/domain/preview-action.type.ts
git commit -m "feat(evening-retro): AgentType.EVENING_RETRO + PREVIEW_KIND 2종 추가"
```

---

### Task 2: AutopilotTaskResult.previews[] + orchestrator 펼침

**Files:**
- Modify: `src/autopilot/domain/autopilot-task.port.ts:17-26`
- Modify: `src/autopilot/application/autopilot.orchestrator.ts:61-63`
- Test: `src/autopilot/application/autopilot.orchestrator.spec.ts` (기존 파일)

**Interfaces:**
- Consumes: `AutopilotPreviewRequest` (기존).
- Produces: `AutopilotTaskResult.previews?: AutopilotPreviewRequest[]` — task가 카드 여러 장. 기존 단수 `preview?` 유지.

- [ ] **Step 1: orchestrator가 previews[]도 펼치는 회귀 테스트 추가**

`autopilot.orchestrator.spec.ts`에 추가(기존 spec 상단 셋업의 mock 이름에 맞춰 조정 — task mock이 `{skip:true, previews:[a,b]}` 반환 시 createPreview 2회, postPreviewMessage targets×2회):
```ts
it('task.result.previews 배열이면 각 항목마다 PreviewGate 카드를 발송한다', async () => {
  const previewA = { kind: 'EVENING_BLOG_PUBLISH', payload: { a: 1 }, previewText: 'A' };
  const previewB = { kind: 'EVENING_CAREER_REFLECT', payload: { b: 2 }, previewText: 'B' };
  fakeTask.run.mockResolvedValue({ skip: true, previews: [previewA, previewB] });
  await orchestrator.runGroup('evening', [entryForFakeTask], 'U1', 'C1');
  expect(createPreview.execute).toHaveBeenCalledTimes(2);
  expect(slackNotifier.postPreviewMessage).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm test -- autopilot.orchestrator.spec`
Expected: FAIL — previews 무시로 createPreview 0회.

- [ ] **Step 3: 인터페이스에 previews 필드 추가**

`src/autopilot/domain/autopilot-task.port.ts`의 `AutopilotTaskResult`에 추가:
```ts
  // T1_PREVIEW 전용 — 있으면 orchestrator 가 preview 단수와 합쳐 각각 PreviewGate 카드 발송.
  // 단수 preview 와 병행 가능(둘 다 있으면 둘 다 발송). 한 task 가 카드 여러 장을 낼 때 사용.
  previews?: AutopilotPreviewRequest[];
```

- [ ] **Step 4: orchestrator에서 previews 펼치기**

`src/autopilot/application/autopilot.orchestrator.ts`의 preview 수집부(현 61-63행)를 다음으로 교체:
```ts
        if (result.preview) {
          previews.push(result.preview);
        }
        if (result.previews) {
          previews.push(...result.previews);
        }
```

- [ ] **Step 5: 테스트 통과**

Run: `pnpm test -- autopilot.orchestrator.spec`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/autopilot/domain/autopilot-task.port.ts src/autopilot/application/autopilot.orchestrator.ts src/autopilot/application/autopilot.orchestrator.spec.ts
git commit -m "feat(autopilot): AutopilotTaskResult.previews[] 로 카드 다장 발송 지원"
```

---

### Task 3: 신규 env 2개 (검증 + 4곳 동기)

**Files:**
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`
- Modify: `.env`
- Modify: `README.md`

**Interfaces:**
- Produces: `EVENING_RETRO_PUBLISH_ENABLED`(string), `EVENING_RETRO_BLOG_NOTION_PAGE_ID`(string optional).

> 기본 ON: task는 `EVENING_RETRO_PUBLISH_ENABLED !== 'false'`로 판정(미설정=ON). `.env.example`/`.env`에는 명시적 `true`.

- [ ] **Step 1: app.config.ts에 검증 필드 추가**

`src/config/app.config.ts`의 optional string env 그룹(`PR_CAREERLOG_AUTO_ENABLED` 근처)에 추가:
```ts
  @IsOptional()
  @IsString()
  EVENING_RETRO_PUBLISH_ENABLED?: string;

  @IsOptional()
  @IsString()
  EVENING_RETRO_BLOG_NOTION_PAGE_ID?: string;
```

- [ ] **Step 2: .env.example / .env 추가**

두 파일 모두에 블록 추가(기존 CAREER_* 근처):
```
# 저녁 회고→발행 후보 (매일 19:00 evening 그룹). false 로 두면 비활성.
EVENING_RETRO_PUBLISH_ENABLED=true
# 블로그 발행 대상 Notion 부모 페이지 ID. 미설정 시 블로그 카드 승인은 명시 에러.
EVENING_RETRO_BLOG_NOTION_PAGE_ID=
```

- [ ] **Step 3: README env 표에 2줄 추가**

`README.md`의 환경변수 표에 두 항목을 표 형식대로 추가.

- [ ] **Step 4: 부팅 검증(env 스키마 통과)**

Run: `pnpm build`
Expected: build 성공. (전체 부팅은 Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/config/app.config.ts .env.example README.md
git commit -m "feat(evening-retro): env 2종 추가 (ENABLED / BLOG_NOTION_PAGE_ID)"
```
(`.env`는 gitignore이므로 add 대상 아님 — 로컬만 갱신.)

---

### Task 4: 회고 프롬프트 + JSON 파서

**Files:**
- Create: `src/agent/blog/domain/prompt/evening-retro.prompt.ts`
- Test: `src/agent/blog/domain/prompt/evening-retro.prompt.spec.ts`

**Interfaces:**
- Produces:
  - `EVENING_RETRO_SYSTEM_PROMPT: string`
  - `buildEveningRetroPrompt(input: { mergedPrs: EveningPrInput[]; worklogText: string | null; dailyEvalText: string | null }): string`
  - `parseEveningRetroOutput(text: string): EveningRetroResult`
  - `EVENING_BLOG_BODY_SYSTEM_PROMPT: string`, `buildEveningBlogBodyPrompt(input: { title; keywords[]; retroContext }): string`
  - 타입:
    ```ts
    export interface EveningPrInput { repo: string; number: number; url: string; title: string; body: string; }
    export interface EveningRetroCandidate { title: string; keywords: string[]; blogValueScore: number; reason: string; }
    export interface EveningRetroResult { retrospective: string; candidates: EveningRetroCandidate[]; }
    ```

- [ ] **Step 1: 파서 테스트 작성**

`evening-retro.prompt.spec.ts`:
```ts
import { parseEveningRetroOutput } from './evening-retro.prompt';

describe('parseEveningRetroOutput', () => {
  it('코드펜스로 감싼 JSON 을 파싱한다', () => {
    const text = '```json\n{"retrospective":"오늘 X 함","candidates":[{"title":"T","keywords":["k1"],"blogValueScore":80,"reason":"R"}]}\n```';
    const result = parseEveningRetroOutput(text);
    expect(result.retrospective).toBe('오늘 X 함');
    expect(result.candidates[0].blogValueScore).toBe(80);
    expect(result.candidates[0].keywords).toEqual(['k1']);
  });

  it('candidates 가 비어도 파싱한다', () => {
    const text = '{"retrospective":"r","candidates":[]}';
    expect(parseEveningRetroOutput(text).candidates).toEqual([]);
  });

  it('파싱 불가 텍스트는 throw', () => {
    expect(() => parseEveningRetroOutput('그냥 문장')).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- evening-retro.prompt.spec`
Expected: FAIL — 모듈/함수 없음.

- [ ] **Step 3: 프롬프트 + 파서 구현**

`evening-retro.prompt.ts`:
```ts
export interface EveningPrInput { repo: string; number: number; url: string; title: string; body: string; }
export interface EveningRetroCandidate { title: string; keywords: string[]; blogValueScore: number; reason: string; }
export interface EveningRetroResult { retrospective: string; candidates: EveningRetroCandidate[]; }

export const EVENING_RETRO_SYSTEM_PROMPT = [
  '당신은 하루 업무를 회고하고 블로그/이력서로 옮길 가치가 있는 작업을 골라내는 시니어 개발자다.',
  '입력(오늘 머지된 PR, 오늘 worklog, 오늘 회고)을 근거로만 판단하고 사실을 지어내지 않는다.',
  '반드시 아래 JSON 스키마 하나만 출력한다(설명·코드펜스 밖 텍스트 금지):',
  '{"retrospective":string(2~4문장 회고),"candidates":[{"title":string,"keywords":string[],"blogValueScore":0~100 정수,"reason":string}]}',
  'blogValueScore 는 "블로그/이력서로 쓸 가치"다. 억지로 높이지 말 것. candidates 는 가치 높은 순으로 정렬.',
].join('\n');

const stripFence = (text: string): string =>
  text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

export const parseEveningRetroOutput = (text: string): EveningRetroResult => {
  const raw = stripFence(text ?? '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('EVENING_RETRO_PARSE_FAILED: JSON 파싱 실패');
  }
  const value = parsed as Partial<EveningRetroResult>;
  if (typeof value?.retrospective !== 'string' || !Array.isArray(value?.candidates)) {
    throw new Error('EVENING_RETRO_PARSE_FAILED: 필수 필드 누락');
  }
  return {
    retrospective: value.retrospective,
    candidates: value.candidates.map((candidate) => ({
      title: String(candidate.title ?? ''),
      keywords: Array.isArray(candidate.keywords) ? candidate.keywords.map(String) : [],
      blogValueScore: Number(candidate.blogValueScore ?? 0),
      reason: String(candidate.reason ?? ''),
    })),
  };
};

export const buildEveningRetroPrompt = (input: {
  mergedPrs: EveningPrInput[];
  worklogText: string | null;
  dailyEvalText: string | null;
}): string => {
  const prSection = input.mergedPrs.length
    ? input.mergedPrs
        .map((pr) => `- [${pr.repo}#${pr.number}] ${pr.title}\n  ${pr.url}\n  ${(pr.body ?? '').slice(0, 500)}`)
        .join('\n')
    : '(오늘 머지된 PR 없음)';
  return [
    '## 오늘 머지된 PR',
    prSection,
    '',
    '## 오늘 worklog',
    input.worklogText ?? '(없음)',
    '',
    '## 오늘 회고(daily-eval)',
    input.dailyEvalText ?? '(없음)',
  ].join('\n');
};

export const EVENING_BLOG_BODY_SYSTEM_PROMPT = [
  '당신은 개발 블로그를 쓰는 시니어 엔지니어다. 주어진 작업을 한국어 기술 블로그 초안으로 작성한다.',
  '과장 없이, 문제→접근→결과 흐름으로. 마크다운(## 소제목, 본문 단락) 형식.',
].join('\n');

export const buildEveningBlogBodyPrompt = (input: {
  title: string;
  keywords: string[];
  retroContext: string;
}): string =>
  [
    `# 주제: ${input.title}`,
    `키워드: ${input.keywords.join(', ')}`,
    '',
    '## 회고 맥락',
    input.retroContext,
    '',
    '위 내용을 바탕으로 기술 블로그 초안(제목 + 본문)을 마크다운으로 작성하라.',
  ].join('\n');
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test -- evening-retro.prompt.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/blog/domain/prompt/evening-retro.prompt.ts src/agent/blog/domain/prompt/evening-retro.prompt.spec.ts
git commit -m "feat(evening-retro): 회고 후보선별 + 블로그 본문 프롬프트/파서"
```

---

### Task 5: EveningRetroPublishTask (소스 수집 + 회고 + previews 구성)

**Files:**
- Create: `src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts`
- Test: `src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.spec.ts`

**Interfaces:**
- Consumes: `AgentRunService.findRecentSucceededRuns`, `GithubClientPort.listAuthorMergedPullRequestsSince`, `ModelRouterUsecase.route`, `ConfigService`, Task 4 프롬프트/파서.
- Produces: `AutopilotTask` with `id = 'evening-retro-publish'`. `run()` 반환:
  - `skip=true` (게이트 OFF / 소스 전무 / 파싱 실패 fallback은 summaryText만)
  - `{ skip:false, summaryText, previews:[...] }` — 블로그 카드는 candidates 있을 때, 경력 카드는 mergedPrs 있을 때.
  - 경력 payload: `{ prRefs: string[], slackUserId }` — `prRefs = mergedPrs.map(pr => 'owner/repo#번호')`.

- [ ] **Step 1: task 동작 테스트 작성 (4 케이스)**

`evening-retro-publish.autopilot-task.spec.ts` — 의존성 전부 mock:
```ts
// (a) 게이트 OFF (config.get('EVENING_RETRO_PUBLISH_ENABLED')='false') → skip=true, route 미호출
// (b) 소스 전무 (PR 0 + worklog null + dailyEval null) → skip=true, route 미호출
// (c) PR 있음 → route 1회, previews.length === 2 (BLOG + CAREER), 경력 payload.prRefs 에 'owner/repo#N' 포함
// (d) PR 없음 + worklog 있음 → route 1회, previews.length === 1 (BLOG only)
```
mock 팁: `config.get.mockImplementation((k)=> k==='EVENING_RETRO_PUBLISH_ENABLED'?enabledVal : k==='IMPACT_REPORT_GITHUB_AUTHOR'?'me':undefined)`, `githubClient.listAuthorMergedPullRequestsSince.mockResolvedValue([{repo:'o/r',number:1,url:'u',title:'t',body:'b',mergedAt:'',additions:0,deletions:0,changedFilesCount:0}])`, `agentRunService.findRecentSucceededRuns` 를 agentType 인자로 분기 mock, `modelRouter.route.mockResolvedValue({text:JSON.stringify({retrospective:'r',candidates:[{title:'T',keywords:['k'],blogValueScore:70,reason:'x'}]}),modelUsed:'gpt',provider:'CHATGPT'})`.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- evening-retro-publish.autopilot-task.spec`
Expected: FAIL — 클래스 없음.

- [ ] **Step 3: task 구현**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  buildEveningRetroPrompt,
  EVENING_RETRO_SYSTEM_PROMPT,
  parseEveningRetroOutput,
  EveningPrInput,
} from '../../../agent/blog/domain/prompt/evening-retro.prompt';
import {
  AutopilotPreviewRequest,
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const RETRO_PR_LIMIT = 20;

// 저녁 회고→발행 후보 — evening 그룹(19:00 KST), daily-eval/work-reviewer 뒤 순서.
// 오늘 머지 PR + 오늘 WORK_REVIEWER/PO_EVAL run 을 재조회해 codex 로 1회 회고→후보 JSON.
// 발송은 orchestrator(T1_PREVIEW) — 여기선 텍스트 + previews 만 만든다.
@Injectable()
export class EveningRetroPublishTask implements AutopilotTask {
  readonly id = 'evening-retro-publish';
  private readonly logger = new Logger(EveningRetroPublishTask.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    private readonly modelRouter: ModelRouterUsecase,
    private readonly config: ConfigService,
  ) {}

  async run({
    ownerSlackUserId,
    firedAtKst,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (this.config.get<string>('EVENING_RETRO_PUBLISH_ENABLED') === 'false') {
      return { skip: true };
    }

    const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    const sinceIsoDate = new Date().toISOString().slice(0, 10);
    const mergedPrs: EveningPrInput[] = author
      ? (
          await this.githubClient.listAuthorMergedPullRequestsSince({
            repo: null,
            author,
            sinceIsoDate,
            limit: RETRO_PR_LIMIT,
          })
        ).map((pr) => ({
          repo: pr.repo,
          number: pr.number,
          url: pr.url,
          title: pr.title,
          body: pr.body,
        }))
      : [];

    const worklogText = await this.readRunText(AgentType.WORK_REVIEWER, ownerSlackUserId);
    const dailyEvalText = await this.readRunText(AgentType.PO_EVAL, ownerSlackUserId);

    if (mergedPrs.length === 0 && !worklogText && !dailyEvalText) {
      return { skip: true };
    }

    try {
      const completion = await this.modelRouter.route({
        agentType: AgentType.EVENING_RETRO,
        request: {
          prompt: buildEveningRetroPrompt({ mergedPrs, worklogText, dailyEvalText }),
          systemPrompt: EVENING_RETRO_SYSTEM_PROMPT,
        },
      });
      const parsed = parseEveningRetroOutput(completion.text);

      const scoreLines = parsed.candidates
        .map((candidate) => `• (${candidate.blogValueScore}점) ${candidate.title} — ${candidate.keywords.join(', ')}`)
        .join('\n');
      const summaryText =
        `🌙 *오늘의 회고 & 발행 후보 — ${firedAtKst}*\n\n${parsed.retrospective}\n\n*발행 후보(가치 점수)*\n${scoreLines || '_후보 없음_'}`;

      const previews: AutopilotPreviewRequest[] = [];
      // 블로그 카드 — 대표(최고점) 후보 기준. candidates 있을 때만.
      const top = parsed.candidates[0];
      if (top) {
        previews.push({
          kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
          payload: {
            topPick: { title: top.title, keywords: top.keywords },
            retroContext: parsed.retrospective,
            slackUserId: ownerSlackUserId,
          },
          previewText: `📝 *블로그 발행 후보* (${top.blogValueScore}점)\n제목: ${top.title}\n키워드: ${top.keywords.join(', ')}\n✅ 누르면 codex 로 본문 생성 후 Notion 발행.`,
        });
      }
      // 경력 카드 — 오늘 머지된 PR 전체를 다건 통합 회고로 반영(#134 활용). LLM 무관, 결정론적.
      if (mergedPrs.length > 0) {
        const prRefs = mergedPrs.map((pr) => `${pr.repo}#${pr.number}`);
        previews.push({
          kind: PREVIEW_KIND.EVENING_CAREER_REFLECT,
          payload: { prRefs, slackUserId: ownerSlackUserId },
          previewText: `💼 *경력 반영 후보* (오늘 머지 ${prRefs.length}건)\n${prRefs.join(', ')}\n✅ 누르면 이력서 프로필 편입 + 포트폴리오 Notion 반영(다건 통합 회고).`,
        });
      }

      return { skip: false, summaryText, previews };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`저녁 회고 생성 실패 — 텍스트 fallback: ${message}`);
      return {
        skip: false,
        summaryText: `🌙 *오늘의 회고 — ${firedAtKst}*\n_회고 자동 생성에 실패했습니다(${message.slice(0, 120)}). 내일 다시 시도합니다._`,
      };
    }
  }

  private async readRunText(
    agentType: AgentType,
    slackUserId: string,
  ): Promise<string | null> {
    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType,
      slackUserId,
      sinceDays: 1,
      limit: 1,
    });
    if (runs.length === 0) {
      return null;
    }
    const output = runs[0].output;
    return typeof output === 'string' ? output : JSON.stringify(output);
  }
}
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test -- evening-retro-publish.autopilot-task.spec`
Expected: PASS (4 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.ts src/autopilot/infrastructure/tasks/evening-retro-publish.autopilot-task.spec.ts
git commit -m "feat(evening-retro): 저녁 회고 autopilot task (소스 수집+codex 회고+previews)"
```

---

### Task 6: EveningBlogPublishApplier (codex 본문 → Notion append)

**Files:**
- Create: `src/agent/blog/infrastructure/evening-blog-publish.applier.ts`
- Test: `src/agent/blog/infrastructure/evening-blog-publish.applier.spec.ts`

**Interfaces:**
- Consumes: `ModelRouterUsecase.route`, `NotionClientPort.findOrCreateChildPage/appendBlocks`, `ConfigService`(EVENING_RETRO_BLOG_NOTION_PAGE_ID), Task 4 본문 프롬프트.
- Produces: `PreviewApplier` with `kind = PREVIEW_KIND.EVENING_BLOG_PUBLISH`.
- payload: `{ topPick:{title,keywords[]}, retroContext, slackUserId }`.

- [ ] **Step 1: applier 테스트 작성**

```ts
// (a) NOTION_PAGE_ID 미설정 → apply 가 throw
// (b) 정상 → route 로 본문 생성 → findOrCreateChildPage → appendBlocks 호출, ApplyResult.message 반환
// (c) payload.topPick 없음 → throw
```
mock: `modelRouter.route.mockResolvedValue({text:'# 제목\n본문', modelUsed:'gpt', provider:'CHATGPT'})`, `notionClient.findOrCreateChildPage.mockResolvedValue({pageId:'p1', url:'u'})`, `notionClient.appendBlocks.mockResolvedValue(undefined)`, `config.get.mockReturnValue('PARENT')`.

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- evening-blog-publish.applier.spec`
Expected: FAIL.

- [ ] **Step 3: applier 구현**

> 구현 전 확인: `ApplyResult`/`PreviewApplier` 경로는 `src/preview-gate/domain/port/preview-applier.port.ts`. `NotionPlanBlock`/`findOrCreateChildPage`/`appendBlocks`의 정확한 타입·필드는 `src/notion/domain/port/notion-client.port.ts` + `src/agent/career-mate/infrastructure/career-mate.formatter.ts`(`buildPortfolioBlocks`)를 열어 실제 블록 형태에 맞춘다.
```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import {
  ApplyResult,
  PreviewApplier,
} from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewAction, PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import {
  buildEveningBlogBodyPrompt,
  EVENING_BLOG_BODY_SYSTEM_PROMPT,
} from '../domain/prompt/evening-retro.prompt';

interface EveningBlogPayload {
  topPick: { title: string; keywords: string[] };
  retroContext: string;
  slackUserId: string;
}

@Injectable()
export class EveningBlogPublishApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_BLOG_PUBLISH;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly config: ConfigService,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningBlogPayload;
    if (!payload?.topPick?.title) {
      throw new Error('EVENING_BLOG_PUBLISH: payload.topPick 누락');
    }
    const parentPageId = this.config
      .get<string>('EVENING_RETRO_BLOG_NOTION_PAGE_ID')
      ?.trim();
    if (!parentPageId) {
      throw new Error('EVENING_RETRO_BLOG_NOTION_PAGE_ID 가 설정되지 않았습니다 (.env 확인).');
    }

    const completion = await this.modelRouter.route({
      agentType: AgentType.EVENING_RETRO,
      request: {
        prompt: buildEveningBlogBodyPrompt({
          title: payload.topPick.title,
          keywords: payload.topPick.keywords,
          retroContext: payload.retroContext,
        }),
        systemPrompt: EVENING_BLOG_BODY_SYSTEM_PROMPT,
      },
    });

    const child = await this.notionClient.findOrCreateChildPage({
      parentPageId,
      title: payload.topPick.title,
    });
    await this.notionClient.appendBlocks({
      pageId: child.pageId,
      blocks: this.toBlocks(completion.text),
    });

    return {
      message: `블로그 초안을 Notion 에 발행했습니다 — ${child.url}`,
      artifacts: [],
    };
  }

  // 마크다운 본문을 문단 블록으로 최소 변환. 실제 NotionPlanBlock 형태는 buildPortfolioBlocks 참고해 맞춘다.
  private toBlocks(markdown: string): NotionPlanBlock[] {
    return markdown
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ type: 'paragraph', text: line })) as unknown as NotionPlanBlock[];
  }
}
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test -- evening-blog-publish.applier.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/blog/infrastructure/evening-blog-publish.applier.ts src/agent/blog/infrastructure/evening-blog-publish.applier.spec.ts
git commit -m "feat(evening-retro): 블로그 발행 applier (codex 본문→Notion append)"
```

---

### Task 7: EveningCareerReflectApplier (오늘 머지 PR 전체 → ReflectPrUsecase 다건 위임)

**Files:**
- Create: `src/agent/career-mate/infrastructure/evening-career-reflect.applier.ts`
- Test: `src/agent/career-mate/infrastructure/evening-career-reflect.applier.spec.ts`

**Interfaces:**
- Consumes: `ReflectPrUsecase.execute({slackUserId, prText})` (#134 — 내부 `extractPrReferences` 다건 파싱, 다건 통합 회고, renderPortfolio 자동).
- Produces: `PreviewApplier` with `kind = PREVIEW_KIND.EVENING_CAREER_REFLECT`.
- payload: `{ prRefs: string[], slackUserId }`.

> 확인 완료(#134): `extractPrReferences`(다건)가 shorthand `owner/repo#번호`·PR URL 모두 파싱(`extract-pr-reference.ts`). `prRefs`를 줄바꿈으로 join하면 다건 통합 회고로 처리된다. `ReflectPrInput={slackUserId,prText}`·`ReflectPrResult.portfolioUrl` 존재.

- [ ] **Step 1: applier 테스트 작성**

```ts
// (a) 정상 → reflectPr.execute({slackUserId, prText: prRefs.join('\n')}) 위임, ApplyResult 반환
// (b) payload.prRefs 빈 배열/누락 → throw
```
mock: `reflectPr.execute.mockResolvedValue({ result:{ portfolioUrl:'u' } })` (ReflectPrResult 형태 확인 후 맞춤).

- [ ] **Step 2: 실패 확인**

Run: `pnpm test -- evening-career-reflect.applier.spec`
Expected: FAIL.

- [ ] **Step 3: applier 구현**

```ts
import { Injectable } from '@nestjs/common';

import { ReflectPrUsecase } from '../application/reflect-pr.usecase';
import {
  ApplyResult,
  PreviewApplier,
} from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewAction, PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';

interface EveningCareerPayload {
  prRefs: string[];
  slackUserId: string;
}

@Injectable()
export class EveningCareerReflectApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_CAREER_REFLECT;

  constructor(private readonly reflectPr: ReflectPrUsecase) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningCareerPayload;
    if (!payload?.prRefs?.length) {
      throw new Error('EVENING_CAREER_REFLECT: payload.prRefs 누락');
    }
    const outcome = await this.reflectPr.execute({
      slackUserId: payload.slackUserId,
      prText: payload.prRefs.join('\n'),
    });
    return {
      message: `이력서/포트폴리오에 반영했습니다 (PR ${payload.prRefs.length}건) — ${outcome.result.portfolioUrl ?? '완료'}`,
      artifacts: [],
    };
  }
}
```

- [ ] **Step 4: 테스트 통과**

Run: `pnpm test -- evening-career-reflect.applier.spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/career-mate/infrastructure/evening-career-reflect.applier.ts src/agent/career-mate/infrastructure/evening-career-reflect.applier.spec.ts
git commit -m "feat(evening-retro): 경력 반영 applier (오늘 머지 PR 다건 통합 위임)"
```

---

### Task 8: 등록 — autopilot module/playbook + PreviewGate forRoot + 부팅 검증

**Files:**
- Modify: `src/autopilot/autopilot.module.ts`
- Modify: `src/autopilot/domain/autopilot.playbook.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: Task 5 `EveningRetroPublishTask`, Task 6 `EveningBlogPublishApplier`, Task 7 `EveningCareerReflectApplier`.

- [ ] **Step 1: autopilot.module.ts — task 등록**

import 추가:
```ts
import { GithubModule } from '../github/github.module';
import { EveningRetroPublishTask } from './infrastructure/tasks/evening-retro-publish.autopilot-task';
```
`imports` 배열에 `GithubModule` 추가(없으면). `providers` 배열에 `EveningRetroPublishTask` 추가. `AUTOPILOT_TASKS` useFactory의 **파라미터·반환배열·inject 3곳 모두**에 추가(기존 `preferenceLearning` 패턴 동일):
```ts
      useFactory: (
        // ...기존 10개,
        eveningRetro: EveningRetroPublishTask,
      ) => [
        // ...기존 10개,
        eveningRetro,
      ],
      inject: [
        // ...기존 10개,
        EveningRetroPublishTask,
      ],
```

- [ ] **Step 2: playbook.ts — evening entry 추가**

`AUTOPILOT_PLAYBOOK` 배열의 `work-reviewer` entry **바로 뒤**(evening 그룹 마지막 순서)에 추가. schedule/timezone은 그룹 일치 규칙상 **반드시** `DEFAULT_DAILY_EVAL_CRON`/`DEFAULT_DAILY_EVAL_TIMEZONE`:
```ts
  // 저녁 회고→발행 후보 — evening 그룹 마지막(daily-eval/work-reviewer 결과가 AgentRun 에 적재된 뒤 재조회).
  // T1_PREVIEW: 블로그/경력 카드는 사용자 승인 후 실행. EVENING_RETRO_PUBLISH_ENABLED=false 시 task skip.
  {
    id: 'evening-retro-publish',
    taskId: 'evening-retro-publish',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DAILY_EVAL_CRON,
      timezone: DEFAULT_DAILY_EVAL_TIMEZONE,
    },
    riskTier: 'T1_PREVIEW',
    digestGroup: 'evening',
  },
```

- [ ] **Step 3: app.module.ts — PreviewGate forRoot 등록**

import 2개 추가:
```ts
import { EveningBlogPublishApplier } from './agent/blog/infrastructure/evening-blog-publish.applier';
import { EveningCareerReflectApplier } from './agent/career-mate/infrastructure/evening-career-reflect.applier';
```
`PreviewGateModule.forRoot({...})`의 `appliers`에 2개 추가:
```ts
    appliers: [
      // ...기존,
      EveningBlogPublishApplier,
      EveningCareerReflectApplier,
    ],
```
DI 해결(중요): appliers는 forRoot providers로 직접 등록되므로 생성자 의존성이 `imports`로 주입 가능해야 한다.
- `EveningBlogPublishApplier` → `ModelRouterUsecase`(ModelRouter 모듈), `NotionClientPort`(NotionModule, 이미 있음), `ConfigService`.
- `EveningCareerReflectApplier` → `ReflectPrUsecase`. forRoot `imports`에 **CareerMate 모듈**을 넣고 그 모듈이 `exports: [ReflectPrUsecase]` 하는지 확인(안 하면 exports 추가). ModelRouter 모듈도 imports에 필요.

- [ ] **Step 4: 부팅 + 전체 테스트 스모크**

Run: `pnpm build && pnpm test`
Expected: build 성공(Nest DI 그래프 해결), 전체 PASS. DI 에러 시 Step 3 imports/exports 조정 후 재실행.

- [ ] **Step 5: Commit**

```bash
git add src/autopilot/autopilot.module.ts src/autopilot/domain/autopilot.playbook.ts src/app.module.ts
git commit -m "feat(evening-retro): task/playbook/PreviewGate 등록 + DI 배선"
```
(CareerMate 모듈 exports 조정 시 그 파일도 함께 add.)

---

### Task 9: 문서 동기화 (AGENTS.md 체크리스트 + docs:check)

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md` (필요 시)
- Run: `pnpm docs:check`

- [ ] **Step 1: docs:check 로 현재 갭 확인**

Run: `pnpm docs:check`
Expected: AgentType/registry 변경 불일치 리포트(있으면).

- [ ] **Step 2: AGENTS.md 갱신**

신규 `AgentType.EVENING_RETRO`, `PREVIEW_KIND` 2종, evening 그룹에 `evening-retro-publish` 반영. §4 체크리스트 중 슬래시/`/retry-run`/`ResponseCode`는 "N/A(autopilot task, 슬래시 미노출)"로 명시.

- [ ] **Step 3: docs:check 통과 확인**

Run: `pnpm docs:check`
Expected: exit 0 (또는 남은 항목이 의도된 N/A임을 확인).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md CLAUDE.md
git commit -m "docs(evening-retro): AgentType/kind/evening 그룹 문서 동기화"
```

---

### Task 10: 최종 3중 green + 수동 확인 노트

- [ ] **Step 1: 3중 게이트**

Run: `pnpm lint:check && pnpm test && pnpm build`
Expected: 세 명령 모두 exit 0.

- [ ] **Step 2: 회귀 스캔**

Run: `pnpm test -- autopilot`
Expected: evening 그룹 기존 테스트(morning-briefing/weekly-summary 포함) 전부 PASS — previews[] 확장이 단수 preview 경로를 안 깼는지.

- [ ] **Step 3: 수동 확인 항목 기록(PR 본문)**

LLM E2E(실제 codex·Notion)는 로컬 터미널 확인 필요:
- `EVENING_RETRO_PUBLISH_ENABLED=true` + `EVENING_RETRO_BLOG_NOTION_PAGE_ID` 설정 후 evening 그룹 수동 트리거 → Slack 카드 2장.
- `[📝 블로그 발행]` → Notion 페이지 생성. `[💼 경력 반영]` → 포트폴리오 append.

---

## Self-Review 결과

- **Spec coverage**: 성공기준 1~6 전부 매핑 — 회고 합류(T5), 카드 2장(T2/T5), 블로그(T6), 경력 다건(T7), 소스 전무 skip(T5), 3중 green(T10). ✅
- **Placeholder scan**: 등록 보일러플레이트(T8)·Notion 블록 형태(T6)만 "기존 파일 참고"로 위임하되 대상 파일·심볼 지정. 나머지 완전 코드. ✅
- **Type consistency**: `EveningRetroResult`/`EveningPrInput`(T4) ↔ task(T5), `PREVIEW_KIND.EVENING_*`(T1) ↔ applier(T6/T7) ↔ payload(T5, `prRefs:string[]`) 일치. `previews`(T2) ↔ task 반환(T5) 일치. ✅
- **해소됨(#134 기준)**: `extractPrReferences` shorthand 지원 확인 → 경력 다건 위임 확정. `ReflectPrInput={slackUserId,prText}` 유지 확인.
- **구현 중 확인**: (a) `NotionPlanBlock` 실제 형태 → T6에서 `buildPortfolioBlocks` 참고, (b) `ReflectPrUsecase` export 여부 → T8에서 CareerMate 모듈 exports 조정, (c) ModelRouter 모듈이 forRoot imports로 주입 가능한지 → T8.
