# docs-sync-audit Phase 2 구현 계획 — 확정 제안 → docs PR (T1_PREVIEW)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 1 이 산출한 확정 문서 수정 제안(`confirmed:true`)을 PreviewGate Slack 승인을 거쳐 octokit docs PR 로 자동 개설한다.

**Architecture:** Layer 2 optimizer 를 search/replace 편집(`{oldString,newString}`) 출력으로 바꾸고, 순수 `DocsRevisionApplier` 가 대상 문서(README)에 정확·유일 매칭으로 편집을 적용해 **전체 새 content** 를 산출한다. autopilot task 가 그 결과를 `AutopilotTaskResult.preview` 로 올리면, orchestrator(T1_PREVIEW 분기 신설)가 `CreatePreviewUsecase` + `postPreviewMessage`(버튼)로 승인을 받고, `DocsAuditPrApplier`(kind `DOCS_AUDIT_PR`)가 `githubClient.pushBranchAndOpenPr` 로 docs PR 을 연다.

**핵심 단순화:** `pushBranchAndOpenPr` 가 `files:{path,content}[]`(전체 새 content)를 받으므로, search/replace 적용본 content 를 직접 넘긴다 — `applyDiffAndReadFiles` 나 unified diff 생성 불필요(diff 는 previewText 표시용으로만 간단 렌더).

**Tech Stack:** NestJS 10, TypeScript, codex CLI via `ModelRouterUsecase`, PreviewGate(`CreatePreviewUsecase`/`PreviewApplier`/`PREVIEW_APPLIERS`), `githubClient.pushBranchAndOpenPr`(octokit), Slack Bolt(`postPreviewMessage`), Jest.

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` — `npm`/`yarn` 금지.
- ORM 은 Prisma 만. `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- LLM 호출은 `ModelRouterUsecase.route(...)` 경유만.
- 외부 쓰기(PR open)는 PreviewGate 승인 후 applier 안에서만. **main 직접 push 절대 X — 항상 새 branch + PR.**
- 코드 스타일(CODE_RULES): `catch (error)`, `const found`, 단일 if 도 중괄호, try 안 `return await`, 인라인 반환 타입 금지, 파일명 kebab-case + role suffix.
- 완료 기준: `pnpm lint:check && pnpm test && pnpm build` 3중 green + `pnpm docs:check` OK.
- **커밋은 사용자 명시 요청 후에만.** 각 Task 의 Commit 스텝은 승인 시에만.
- 새 env 추가 시 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts` + 카탈로그(`pnpm docs:sync`).
- worktree 작업 — Read/Edit 절대경로는 항상 worktree prefix(`.claude/worktrees/feat+docs-sync-audit-phase2/`).

---

## 재사용 인터페이스 (정독 완료 — 인용)

```ts
// src/github/domain/port/github-client.port.ts
interface PushBranchAndOpenPrInput {
  repo: string; baseBranch: string; branchName: string; commitMessage: string;
  files: { path: string; content: string }[]; prTitle: string; prBody: string;
}
interface PushBranchAndOpenPrResult { prUrl: string; prNumber: number; branchRef: string; commitSha: string; }
// GithubClientPort.pushBranchAndOpenPr(input): Promise<PushBranchAndOpenPrResult>
// DI: GITHUB_CLIENT_PORT

// src/preview-gate/domain/apply-result.type.ts
type VerifiableArtifact = { type: 'github_pr'; repo: string; prNumber: number };
interface ApplyResult { message: string; artifacts: VerifiableArtifact[]; }

// src/preview-gate/domain/port/preview-applier.port.ts
interface PreviewApplier { readonly kind: PreviewKind; apply(preview: PreviewAction): Promise<ApplyResult>; }
// 등록: PreviewGateModule.forRoot([...applierClasses]) → PREVIEW_APPLIERS (app.module.ts)
// resolve: ApplyPreviewUsecase 가 appliers.find(a => a.kind === preview.kind)

// src/preview-gate/application/create-preview.usecase.ts (PreviewGateModule @Global → 어디서나 inject)
// CreatePreviewUsecase.execute({ slackUserId, kind, payload, previewText, responseUrl, ttlMs }): Promise<PreviewAction>

// src/slack/slack.service.ts (SLACK_NOTIFIER_PORT useExisting SlackService)
// SlackService.postPreviewMessage({ target, previewText, previewId }): Promise<void>  // 이미 존재

// src/agent/be-sandbox/domain/be-sandbox-push-pr.type.ts — 미러 대상 (payload 가드 + parseRepoLabel 패턴)
```

---

## File Structure

**생성:**
- `src/docs-audit/infrastructure/docs-revision.applier.ts` — 순수: 확정 제안 edits → 대상 문서에 정확·유일 매칭 적용 → `{ files:{path,content}[], changedFiles, previewText }`
- `src/docs-audit/domain/docs-audit-pr.type.ts` — `DocsAuditPrPayload` + `isDocsAuditPrPayload` 가드 + `parseRepoLabel`(재사용 import)
- `src/docs-audit/infrastructure/docs-audit-pr.applier.ts` — `PreviewApplier`(kind `DOCS_AUDIT_PR`) → `pushBranchAndOpenPr`
- 각 `*.spec.ts`

**수정:**
- `src/docs-audit/domain/port/docs-audit.port.ts` — `DocEdit` + `OptimizerOutput.edits` + `DocsRevisionProposal.edits`
- `src/docs-audit/domain/prompt/docs-audit.prompt.ts` — search/replace JSON 출력
- `src/docs-audit/infrastructure/codex-docs-judge.adapter.ts` — `edits[]` 파싱
- `src/docs-audit/application/run-docs-audit.usecase.ts` — SoT→targetDoc 매핑 + 분리 로드 + edits 흐름
- `src/docs-audit/docs-audit.module.ts` — full-doc reader 주입 + DocsRevisionApplier provider + revision 산출 노출
- `src/preview-gate/domain/preview-action.type.ts` — `PREVIEW_KIND.DOCS_AUDIT_PR`
- `src/morning-briefing/domain/port/slack-notifier.port.ts` — `postPreviewMessage` 추가
- `src/autopilot/domain/autopilot-task.port.ts` — `AutopilotTaskResult.preview?`
- `src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.ts` — `DOCS_AUDIT_PR_ENABLED` 게이트 → preview 페이로드 산출
- `src/autopilot/application/autopilot.orchestrator.ts` — T1_PREVIEW 분기(CreatePreview + postPreviewMessage)
- `src/autopilot/domain/autopilot.playbook.ts` — docs-sync-audit `riskTier:'T1_PREVIEW'`(게이트 ON 시)
- `src/autopilot/autopilot.module.ts` — CreatePreviewUsecase 주입(전역) 확인
- `src/app.module.ts` — `PreviewGateModule.forRoot([... , DocsAuditPrApplier])` 등록 + DocsAuditModule export 노출
- `src/config/app.config.ts` + `.env.example` + `.env` — env 3종

---

## Task 1: 포트 타입 — DocEdit + edits

**Files:**
- Modify: `src/docs-audit/domain/port/docs-audit.port.ts`

**Interfaces:**
- Produces: `DocEdit { oldString, newString }`, `OptimizerOutput.edits: DocEdit[]`, `DocsRevisionProposal.edits: DocEdit[]`

- [ ] **Step 1: 타입 수정** — `OptimizerOutput`/`DocsRevisionProposal` 의 `proposedDiff: string` 제거, `edits` 추가:

```ts
// Layer 2 — 한 건의 문서 편집(정확·유일 매칭 search/replace).
export interface DocEdit {
  // 대상 문서에서 정확히 1회 매칭돼야 하는 원본 문자열(개행 포함 가능).
  oldString: string;
  // 치환 문자열.
  newString: string;
}

export interface OptimizerOutput {
  needsRevision: boolean;
  filePath: string; // 대상 문서(targetDoc) 경로
  edits: DocEdit[];
  rationale: string;
}

export interface DocsRevisionProposal {
  filePath: string; // 대상 문서 경로
  edits: DocEdit[];
  rationale: string;
  score: number;
  confirmed: boolean;
}

// Layer 2 적용 산출 — DocsRevisionApplier 가 채우고 task→preview payload 로 흐른다.
// (순환 import 회피 위해 domain port 에 정의 — applier 가 여기서 import.)
export interface DocsRevision {
  files: { path: string; content: string }[];
  changedFiles: string[];
  previewText: string;
}

// DocsAuditResult 에 revision 추가(확정 제안의 적용 결과 — 없으면 null).
export interface DocsAuditResult {
  deterministic: DeterministicDriftReport;
  proposals: DocsRevisionProposal[];
  revision: DocsRevision | null;
}
```

> `EvaluatorVerdict`/`DeterministicDriftReport`/`DocsAuditPort` 는 그대로. 기존 `DocsAuditResult`(proposals 만) 는 위 정의로 교체 — `revision` 필드 추가가 Task 7 까지의 빌드를 깨지 않도록 Task 1~6 동안엔 usecase 가 `revision: null` 을 채워 둔다(Task 4 Step 3 에서 `revision: null` 임시 반환, Task 7 에서 실제 산출로 교체).

- [ ] **Step 2: 빌드(타입만)** — `pnpm build` → Task 2~4 전이라 adapter/usecase 가 깨짐(예상). 이 Task 단독 검증은 Task 3 에서 함께. 여기선 타입 선언만 확인.

- [ ] **Step 3: Commit**(승인 시) — `git commit -m "feat(docs-audit): OptimizerOutput/Proposal 을 search/replace edits 로 (Phase 2)"`

---

## Task 2: 프롬프트 — search/replace 출력

**Files:**
- Modify: `src/docs-audit/domain/prompt/docs-audit.prompt.ts`

- [ ] **Step 1: optimizer 프롬프트 교체**:

```ts
export const OPTIMIZER_SYSTEM_PROMPT =
  '당신은 코드(SoT)와 문서를 대조해 "문서가 코드와 의미적으로 어긋났는지" 판정하고, ' +
  '어긋났으면 문서를 고치는 최소 편집을 제안하는 기술 문서 검수자입니다. ' +
  '편집은 search/replace 형식 — oldString 은 대상 문서에 "정확히 한 번" 나타나는 부분 문자열이어야 하며(공백/개행 포함 그대로 복사), newString 은 그 치환입니다. ' +
  '코드 사실만 근거로 삼고 추측 금지. 반드시 아래 JSON 한 개만 출력합니다.\n' +
  '{"needsRevision": boolean, "edits": [{"oldString": string, "newString": string}], "rationale": string}';
```

> `buildOptimizerPrompt`/`EVALUATOR_SYSTEM_PROMPT`/`buildEvaluatorPrompt` 시그니처는 유지. `buildEvaluatorPrompt` 의 `proposedDiff` 인자명은 `editsSummary` 로 바꾸고(아래 Task 4 에서 호출부 갱신) 본문 텍스트는 "제안된 편집"으로:

```ts
export function buildEvaluatorPrompt(input: {
  filePath: string;
  codeContext: string;
  editsSummary: string;
}): string {
  return [
    `[대상 문서] ${input.filePath}`,
    `[관련 코드(SoT) 발췌]\n${input.codeContext}`,
    `[제안된 편집]\n${input.editsSummary}`,
    '이 편집이 코드 사실과 정확히 일치하는지 채점하세요. 과수정/부족수정도 감점하세요.',
  ].join('\n\n');
}
```

- [ ] **Step 2: Commit**(승인 시) — `git commit -m "feat(docs-audit): optimizer 프롬프트 search/replace 출력"`

---

## Task 3: codex adapter — edits 파싱

**Files:**
- Modify: `src/docs-audit/infrastructure/codex-docs-judge.adapter.ts`
- Modify: `src/docs-audit/infrastructure/codex-docs-judge.adapter.spec.ts`

**Interfaces:**
- Produces: `optimize(input): OptimizerOutput`(edits 채움), `evaluate({filePath,codeContext,editsSummary})`

- [ ] **Step 1: 실패 테스트로 spec 교체**(edits 파싱):

```ts
import { CodexDocsJudgeAdapter } from './codex-docs-judge.adapter';

describe('CodexDocsJudgeAdapter', () => {
  const makeRouter = (text: string) =>
    ({ route: jest.fn().mockResolvedValue({ text }) }) as any;

  it('optimize: edits 배열 파싱', async () => {
    const router = makeRouter(
      '{"needsRevision": true, "edits": [{"oldString":"a","newString":"b"}], "rationale": "r"}',
    );
    const out = await new CodexDocsJudgeAdapter(router).optimize({
      filePath: 'README.md', codeContext: 'c', docExcerpt: 'd',
    });
    expect(out.needsRevision).toBe(true);
    expect(out.edits).toEqual([{ oldString: 'a', newString: 'b' }]);
    expect(out.filePath).toBe('README.md');
  });

  it('optimize: edits 없거나 형식 불량이면 needsRevision=false + 빈 edits', async () => {
    const out = await new CodexDocsJudgeAdapter(makeRouter('주절주절')).optimize({
      filePath: 'x', codeContext: '', docExcerpt: '',
    });
    expect(out.needsRevision).toBe(false);
    expect(out.edits).toEqual([]);
  });

  it('evaluate: pass/score 파싱(editsSummary 입력)', async () => {
    const router = makeRouter('{"pass": true, "score": 95, "feedback": "ok"}');
    const verdict = await new CodexDocsJudgeAdapter(router).evaluate({
      filePath: 'README.md', codeContext: 'c', editsSummary: 'a→b',
    });
    expect(verdict).toEqual({ pass: true, score: 95, feedback: 'ok' });
  });
});
```

- [ ] **Step 2: 테스트 → FAIL** (`pnpm test -- codex-docs-judge.adapter`).

- [ ] **Step 3: adapter 구현 수정** — `optimize` 의 반환을 edits 파싱으로, `evaluate` 입력을 `editsSummary` 로:

```ts
async optimize(input: {
  filePath: string; codeContext: string; docExcerpt: string; evaluatorFeedback?: string;
}): Promise<OptimizerOutput> {
  const completion = await this.modelRouter.route({
    agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
    request: { prompt: buildOptimizerPrompt(input), systemPrompt: OPTIMIZER_SYSTEM_PROMPT },
  });
  const parsed = this.parseJson(completion.text);
  const edits = this.parseEdits(parsed?.edits);
  return {
    needsRevision: parsed?.needsRevision === true && edits.length > 0,
    filePath: input.filePath,
    edits,
    rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : '',
  };
}

async evaluate(input: {
  filePath: string; codeContext: string; editsSummary: string;
}): Promise<EvaluatorVerdict> {
  const completion = await this.modelRouter.route({
    agentType: AgentType.DOCS_AUDIT_EVALUATOR,
    request: { prompt: buildEvaluatorPrompt(input), systemPrompt: EVALUATOR_SYSTEM_PROMPT },
  });
  const parsed = this.parseJson(completion.text);
  const score = typeof parsed?.score === 'number' ? parsed.score : 0;
  return {
    pass: parsed?.pass === true,
    score,
    feedback: typeof parsed?.feedback === 'string' ? parsed.feedback : '',
  };
}

// edits 배열을 안전 파싱 — 각 항목이 string oldString/newString 일 때만 채택.
private parseEdits(raw: unknown): DocEdit[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const edits: DocEdit[] = [];
  for (const item of raw) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>).oldString === 'string' &&
      typeof (item as Record<string, unknown>).newString === 'string' &&
      ((item as Record<string, unknown>).oldString as string).length > 0
    ) {
      const record = item as Record<string, unknown>;
      edits.push({ oldString: record.oldString as string, newString: record.newString as string });
    }
  }
  return edits;
}
```

import 에 `DocEdit` 추가(`OptimizerOutput, EvaluatorVerdict, DocEdit`).

- [ ] **Step 4: 테스트 → PASS**.
- [ ] **Step 5: Commit**(승인 시) — `git commit -m "feat(docs-audit): adapter edits 파싱"`

---

## Task 4: run-docs-audit — SoT→문서 매핑 + 분리 로드

**Files:**
- Modify: `src/docs-audit/application/run-docs-audit.usecase.ts`
- Modify: `src/docs-audit/application/run-docs-audit.usecase.spec.ts`

**Interfaces:**
- Consumes: adapter(`optimize`/`evaluate`), `DocExcerptReader`
- Produces: `DocsRevisionProposal.edits` 채운 결과. SoT→targetDoc 매핑 적용.

설계: `auditOneFile(sotFile)` 가 ① SoT 파일 발췌(codeContext) ② **매핑된 targetDoc 발췌**(docExcerpt) 를 분리 로드. evaluator 입력은 `editsSummary`(edits 를 텍스트로). 종료조건 3종 유지.

- [ ] **Step 1: 실패 테스트 갱신** — 기존 4 케이스의 mock 을 edits 기반으로 + SoT≠targetDoc 분리 검증 추가:

```ts
import { RunDocsAuditUseCase, SOT_TO_DOC } from './run-docs-audit.usecase';

const cleanDeterministic = { inSync: true, details: [] };

function makeDeps(over: any = {}) {
  return {
    checker: { check: jest.fn().mockResolvedValue(cleanDeterministic) },
    gitFiles: { recentlyChangedSotFiles: jest.fn().mockResolvedValue(['src/config/app.config.ts']) },
    judge: { optimize: jest.fn(), evaluate: jest.fn() },
    reader: jest.fn().mockImplementation((p: string) => Promise.resolve(`발췌:${p}`)),
    maxFiles: 5, maxIterations: 3, ...over,
  };
}
const build = (d: any) => new RunDocsAuditUseCase(d.checker, d.gitFiles, d.judge, d.reader, d.maxFiles, d.maxIterations);

it('(a) green → 확정 제안 1건 (edits 포함)', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue({ needsRevision: true, filePath: 'README.md', edits: [{ oldString: 'a', newString: 'b' }], rationale: 'r' });
  d.judge.evaluate.mockResolvedValue({ pass: true, score: 95, feedback: 'ok' });
  const result = await build(d).runAudit();
  expect(result.proposals).toHaveLength(1);
  expect(result.proposals[0].confirmed).toBe(true);
  expect(result.proposals[0].edits).toEqual([{ oldString: 'a', newString: 'b' }]);
});

it('codeContext=SoT, docExcerpt=매핑된 targetDoc(README) 로 분리 로드', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue({ needsRevision: false, filePath: 'README.md', edits: [], rationale: '' });
  await build(d).runAudit();
  const call = d.judge.optimize.mock.calls[0][0];
  expect(call.codeContext).toContain('src/config/app.config.ts');
  expect(call.docExcerpt).toContain(SOT_TO_DOC['src/config/app.config.ts']);
});

it('(b) 미달 → maxIterations 후 미확정', async () => {
  const d = makeDeps({ maxIterations: 3 });
  d.judge.optimize.mockResolvedValue({ needsRevision: true, filePath: 'README.md', edits: [{ oldString: 'a', newString: 'b' }], rationale: 'r' });
  d.judge.evaluate.mockResolvedValueOnce({ pass: false, score: 50, feedback: 'f' })
    .mockResolvedValueOnce({ pass: false, score: 60, feedback: 'f' })
    .mockResolvedValueOnce({ pass: false, score: 70, feedback: 'f' });
  const result = await build(d).runAudit();
  expect(d.judge.optimize).toHaveBeenCalledTimes(3);
  expect(result.proposals[0].confirmed).toBe(false);
});

it('(d) needsRevision=false → 제안 없음', async () => {
  const d = makeDeps();
  d.judge.optimize.mockResolvedValue({ needsRevision: false, filePath: 'README.md', edits: [], rationale: '' });
  const result = await build(d).runAudit();
  expect(result.proposals).toHaveLength(0);
  expect(d.judge.evaluate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 테스트 → FAIL**.

- [ ] **Step 3: 구현 수정** — 매핑 상수 + 분리 로드 + edits/editsSummary:

```ts
// 문서 드리프트를 일으키는 SoT → 대조/수정 대상 문서(hand-curated) 매핑.
// 1차 README.md 단일. 생성 카탈로그(agent-catalog/env-catalog)는 Layer1 담당이라 제외.
export const SOT_TO_DOC: Readonly<Record<string, string>> = {
  'src/agent-registry/agent-registry.ts': 'README.md',
  'src/config/app.config.ts': 'README.md',
  'src/model-router/application/model-router.usecase.ts': 'README.md',
};

// auditOneFile 내부 변경점:
const sotContext = await this.readExcerpt(sotFile);
const targetDoc = SOT_TO_DOC[sotFile];
if (!targetDoc) {
  return null; // 매핑 없는 SoT 는 skip
}
const docExcerpt = await this.readExcerpt(targetDoc);
// ...
const optimized = await this.judge.optimize({
  filePath: targetDoc, codeContext: sotContext, docExcerpt, evaluatorFeedback: feedback,
});
if (!optimized.needsRevision) {
  return null;
}
const verdict = await this.judge.evaluate({
  filePath: targetDoc,
  codeContext: sotContext,
  editsSummary: summarizeEdits(optimized.edits),
});
best = { edits: optimized.edits, rationale: optimized.rationale, score: verdict.score };
// green 시: return { filePath: targetDoc, ...best, confirmed: true };
```

`best` 타입을 `{ edits: DocEdit[]; rationale: string; score: number }` 로, 반환을 `{ filePath: targetDoc, ...best, confirmed }` 로. **`runAudit` 의 반환은 이 Task 에서 `{ deterministic, proposals, revision: null }`** 로(Task 1 의 새 `DocsAuditResult` 충족 — 실제 revision 산출은 Task 7). `import { DocEdit } from '../domain/port/docs-audit.port'` 추가. 파일 하단에 helper:

```ts
// edits 를 evaluator 가 읽을 텍스트로 요약.
function summarizeEdits(edits: { oldString: string; newString: string }[]): string {
  return edits
    .map((e, i) => `#${i + 1}\n- old:\n${e.oldString}\n- new:\n${e.newString}`)
    .join('\n\n');
}
```

> `auditOneFile(filePath)` 의 파라미터명을 `sotFile` 로. 루프 변수 `for (const sotFile of files)`.

- [ ] **Step 4: 테스트 → PASS** (4 케이스 + 분리로드).
- [ ] **Step 5: Commit**(승인 시) — `git commit -m "feat(docs-audit): SoT→문서 매핑 + 분리 로드 + edits 흐름"`

---

## Task 5: DocsRevisionApplier (순수 — 편집 적용 + content 산출)

**Files:**
- Create: `src/docs-audit/infrastructure/docs-revision.applier.ts`
- Test: `src/docs-audit/infrastructure/docs-revision.applier.spec.ts`

**Interfaces:**
- Consumes: `DocsRevisionProposal`(Task 1), 전체 문서 로더 `(path)=>Promise<string>`
- Produces: `DocsRevisionApplier.buildRevision(confirmed: DocsRevisionProposal[]): Promise<DocsRevision | null>`
  - `DocsRevision = { files: {path,content}[]; changedFiles: string[]; previewText: string }`

설계: confirmed 제안의 edits 를 **파일별로 묶어** 전체 문서 content 에 정확·유일 매칭 치환. 매칭 0/다중인 edit 은 그 edit 만 skip(나머지 적용). 적용된 파일만 `files` 에. 적용 0건이면 null.

- [ ] **Step 1: 실패 테스트**:

```ts
import { DocsRevisionApplier } from './docs-revision.applier';

const reader = (docs: Record<string, string>) => (p: string) => Promise.resolve(docs[p] ?? '');

it('정확·유일 매칭 치환 → files+changedFiles+previewText', async () => {
  const applier = new DocsRevisionApplier(reader({ 'README.md': 'hello OLD world' }));
  const rev = await applier.buildRevision([
    { filePath: 'README.md', edits: [{ oldString: 'OLD', newString: 'NEW' }], rationale: 'r', score: 95, confirmed: true },
  ]);
  expect(rev!.files).toEqual([{ path: 'README.md', content: 'hello NEW world' }]);
  expect(rev!.changedFiles).toEqual(['README.md']);
  expect(rev!.previewText).toContain('README.md');
});

it('다중매칭 edit 은 skip — 적용 0건이면 null', async () => {
  const applier = new DocsRevisionApplier(reader({ 'README.md': 'x x' }));
  const rev = await applier.buildRevision([
    { filePath: 'README.md', edits: [{ oldString: 'x', newString: 'y' }], rationale: 'r', score: 95, confirmed: true },
  ]);
  expect(rev).toBeNull();
});

it('매칭0 edit 은 skip, 같은 파일 다른 edit 은 적용', async () => {
  const applier = new DocsRevisionApplier(reader({ 'README.md': 'keep AAA tail' }));
  const rev = await applier.buildRevision([
    { filePath: 'README.md', edits: [{ oldString: 'ZZZ', newString: 'q' }, { oldString: 'AAA', newString: 'BBB' }], rationale: 'r', score: 95, confirmed: true },
  ]);
  expect(rev!.files[0].content).toBe('keep BBB tail');
});
```

- [ ] **Step 2: 테스트 → FAIL**.

- [ ] **Step 3: 구현**:

```ts
import { Injectable } from '@nestjs/common';

import {
  DocEdit,
  DocsRevision,
  DocsRevisionProposal,
} from '../domain/port/docs-audit.port';

// 전체 문서 content 로더 — 모듈에서 fs.readFile 래퍼 주입. (DocsRevision 은 port 에 정의됨 — Task 1.)
export type FullDocReader = (path: string) => Promise<string>;

// 순수 — confirmed 제안의 edits 를 대상 문서에 정확·유일 매칭으로 적용해 전체 새 content 산출.
// octokit 무관(테스트 용이). 매칭 0/다중 edit 은 skip(부작용 회피). 적용 0건이면 null.
@Injectable()
export class DocsRevisionApplier {
  constructor(private readonly readDoc: FullDocReader) {}

  async buildRevision(
    confirmed: DocsRevisionProposal[],
  ): Promise<DocsRevision | null> {
    const editsByDoc = new Map<string, DocEdit[]>();
    for (const proposal of confirmed) {
      const bucket = editsByDoc.get(proposal.filePath);
      if (bucket) {
        bucket.push(...proposal.edits);
      } else {
        editsByDoc.set(proposal.filePath, [...proposal.edits]);
      }
    }

    const files: { path: string; content: string }[] = [];
    const previewLines: string[] = [];
    for (const [path, edits] of editsByDoc) {
      const original = await this.readDoc(path);
      let content = original;
      const applied: DocEdit[] = [];
      for (const edit of edits) {
        const occurrences = content.split(edit.oldString).length - 1;
        if (occurrences !== 1) {
          continue; // 매칭 0/다중 — 안전상 skip
        }
        content = content.replace(edit.oldString, edit.newString);
        applied.push(edit);
      }
      if (content === original || applied.length === 0) {
        continue;
      }
      files.push({ path, content });
      previewLines.push(`*${path}* — ${applied.length}개 편집`);
      for (const edit of applied) {
        previewLines.push(
          `> \`${truncate(edit.oldString)}\` → \`${truncate(edit.newString)}\``,
        );
      }
    }

    if (files.length === 0) {
      return null;
    }
    return {
      files,
      changedFiles: files.map((file) => file.path),
      previewText: previewLines.join('\n'),
    };
  }
}

const PREVIEW_SNIPPET_CAP = 120;
function truncate(text: string): string {
  const oneLine = text.replace(/\n/gu, '↵');
  return oneLine.length > PREVIEW_SNIPPET_CAP
    ? `${oneLine.slice(0, PREVIEW_SNIPPET_CAP)}…`
    : oneLine;
}
```

- [ ] **Step 4: 테스트 → PASS**.
- [ ] **Step 5: Commit**(승인 시) — `git commit -m "feat(docs-audit): DocsRevisionApplier (정확매칭 적용 + content 산출)"`

---

## Task 6: DOCS_AUDIT_PR payload + applier

**Files:**
- Create: `src/docs-audit/domain/docs-audit-pr.type.ts`
- Create: `src/docs-audit/infrastructure/docs-audit-pr.applier.ts`
- Test: `src/docs-audit/infrastructure/docs-audit-pr.applier.spec.ts`
- Modify: `src/preview-gate/domain/preview-action.type.ts`

**Interfaces:**
- Consumes: `GithubClientPort.pushBranchAndOpenPr`, `DocsRevision.files`
- Produces: `PREVIEW_KIND.DOCS_AUDIT_PR`, `DocsAuditPrPayload`, `DocsAuditPrApplier implements PreviewApplier`

- [ ] **Step 1: PREVIEW_KIND 추가** — `preview-action.type.ts` 의 `PREVIEW_KIND` 객체에:

```ts
  // docs-sync-audit Phase 2 — 확정 문서 수정 제안을 docs PR 로 open.
  // payload = { files:[{path,content}], changedFiles, rationale, repoLabel, baseBranch } (DocsAuditPrPayload).
  // applier 가 githubClient.pushBranchAndOpenPr 로 새 branch+commit+PR. main 직접 push X.
  DOCS_AUDIT_PR: 'DOCS_AUDIT_PR',
```

- [ ] **Step 2: payload 타입 + 가드 작성** (`docs-audit-pr.type.ts`):

```ts
// docs-sync-audit Phase 2 — PreviewGate payload. DocsRevisionApplier 가 산출, DocsAuditPrApplier 가 narrow.
export interface DocsAuditPrPayload {
  files: { path: string; content: string }[]; // 전체 새 content
  changedFiles: string[];
  rationale: string; // PR body 에 동봉할 변경 의도
  repoLabel: string; // "owner/repo"
  baseBranch: string;
}

const REPO_LABEL_PATTERN = /^[^/\s]+\/[^/\s]+$/u;

export const isDocsAuditPrPayload = (
  value: unknown,
): value is DocsAuditPrPayload => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.files) &&
    record.files.length > 0 &&
    record.files.every(
      (file) =>
        file !== null &&
        typeof file === 'object' &&
        typeof (file as Record<string, unknown>).path === 'string' &&
        typeof (file as Record<string, unknown>).content === 'string',
    ) &&
    Array.isArray(record.changedFiles) &&
    record.changedFiles.every((path) => typeof path === 'string') &&
    record.changedFiles.length > 0 &&
    typeof record.rationale === 'string' &&
    typeof record.repoLabel === 'string' &&
    REPO_LABEL_PATTERN.test(record.repoLabel) &&
    typeof record.baseBranch === 'string' &&
    record.baseBranch.trim().length > 0
  );
};

export const parseRepoLabel = (
  repoLabel: string,
): { owner: string; repo: string } => {
  const slash = repoLabel.indexOf('/');
  return { owner: repoLabel.slice(0, slash), repo: repoLabel.slice(slash + 1) };
};
```

- [ ] **Step 3: applier 실패 테스트** (`docs-audit-pr.applier.spec.ts`):

```ts
import { DocsAuditPrApplier } from './docs-audit-pr.applier';
import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';

function makeGithub(result: any) {
  return { pushBranchAndOpenPr: jest.fn().mockResolvedValue(result) } as any;
}
const basePreview = {
  id: 'p1', slackUserId: 'U1', kind: PREVIEW_KIND.DOCS_AUDIT_PR,
  status: 'PENDING', previewText: 't', responseUrl: null,
  expiresAt: new Date(0), createdAt: new Date(0), appliedAt: null, cancelledAt: null,
};
const payload = {
  files: [{ path: 'README.md', content: 'new' }], changedFiles: ['README.md'],
  rationale: '문서 동기화', repoLabel: 'JSL107/personal_agents', baseBranch: 'main',
};

it('payload 검증 후 pushBranchAndOpenPr 호출 + github_pr artifact', async () => {
  const github = makeGithub({ prUrl: 'http://x/1', prNumber: 1, branchRef: 'refs/heads/b', commitSha: 'abc123' });
  const applier = new DocsAuditPrApplier(github);
  const result = await applier.apply({ ...basePreview, payload } as any);
  expect(github.pushBranchAndOpenPr).toHaveBeenCalledTimes(1);
  const arg = github.pushBranchAndOpenPr.mock.calls[0][0];
  expect(arg.repo).toBe('JSL107/personal_agents');
  expect(arg.baseBranch).toBe('main');
  expect(arg.files).toEqual([{ path: 'README.md', content: 'new' }]);
  expect(arg.branchName).toMatch(/^docs\/idaeri-docs-sync-/u);
  expect(result.artifacts).toEqual([{ type: 'github_pr', repo: 'JSL107/personal_agents', prNumber: 1 }]);
  expect(result.message).toContain('http://x/1');
});

it('payload 형식 불량이면 throw (push 안 함)', async () => {
  const github = makeGithub({});
  const applier = new DocsAuditPrApplier(github);
  await expect(applier.apply({ ...basePreview, payload: { bad: true } } as any)).rejects.toBeDefined();
  expect(github.pushBranchAndOpenPr).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: 테스트 → FAIL**.

- [ ] **Step 5: applier 구현** (`docs-audit-pr.applier.ts`) — `BeSandboxPushPrApplier` 미러하되 content 직접 전달:

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../github/domain/port/github-client.port';
import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../preview-gate/domain/preview-action-error-code.enum';
import {
  isDocsAuditPrPayload,
  parseRepoLabel,
} from '../domain/docs-audit-pr.type';

const PR_BODY_CAP = 4_000;

// PreviewKind.DOCS_AUDIT_PR strategy — 확정 문서 수정 제안을 docs PR 로 open.
// content 를 이미 보유(DocsRevisionApplier 산출)하므로 diff 적용 단계 없이 pushBranchAndOpenPr 에 직접 전달.
// main 직접 push 절대 X — 항상 새 branch.
@Injectable()
export class DocsAuditPrApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.DOCS_AUDIT_PR;
  private readonly logger = new Logger(DocsAuditPrApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    if (!isDocsAuditPrPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: 'DOCS_AUDIT_PR payload 형식이 맞지 않습니다.',
        status: DomainStatus.INTERNAL,
      });
    }
    const { files, changedFiles, rationale, repoLabel, baseBranch } =
      preview.payload;
    const { owner, repo } = parseRepoLabel(repoLabel);
    const branchName = `docs/idaeri-docs-sync-${preview.id}`;
    const prTitle = `docs: 문서↔코드 동기화 (docs-sync-audit) — ${changedFiles.join(', ')}`;
    const commitMessage = `docs(sync): docs-sync-audit 자동 제안\n\n${rationale.slice(0, PR_BODY_CAP)}`;
    const prBody = buildPrBody({ rationale, changedFiles, branchName });

    try {
      const result = await this.githubClient.pushBranchAndOpenPr({
        repo: repoLabel,
        baseBranch,
        branchName,
        commitMessage,
        files,
        prTitle: prTitle.slice(0, 80),
        prBody,
      });
      this.logger.log(
        `docs-sync-audit PR open — ${owner}/${repo} #${result.prNumber} (${result.prUrl})`,
      );
      const message = [
        '📄 *docs-sync-audit — 문서 동기화 PR 생성됨*',
        '',
        `• 대상: ${owner}/${repo} (base \`${baseBranch}\`)`,
        `• 변경 파일: ${changedFiles.join(', ')}`,
        `*PR* — <${result.prUrl}|#${result.prNumber}>`,
        '',
        '_머지 전 사용자 검토 필수._',
      ].join('\n');
      return {
        message,
        artifacts: [
          { type: 'github_pr', repo: repoLabel, prNumber: result.prNumber },
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`docs-sync-audit PR open 실패 — ${owner}/${repo}: ${message}`);
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: `docs PR open 실패: ${message.slice(0, 300)}`,
        status: DomainStatus.BAD_GATEWAY,
      });
    }
  }
}

function buildPrBody({
  rationale,
  changedFiles,
  branchName,
}: {
  rationale: string;
  changedFiles: string[];
  branchName: string;
}): string {
  return [
    '## 자동 생성 — 이대리 docs-sync-audit (Phase 2)',
    '',
    `**branch**: \`${branchName}\``,
    `**변경 파일**: ${changedFiles.map((file) => `\`${file}\``).join(', ')}`,
    '',
    '## 변경 근거',
    rationale.slice(0, PR_BODY_CAP),
    '',
    '_문서↔코드 동기화 점검(evaluator 확정)을 사용자 ✅ 승인 후 자동 PR. 머지 전 검토 필수._',
  ].join('\n');
}
```

- [ ] **Step 6: 테스트 → PASS**.
- [ ] **Step 7: Commit**(승인 시) — `git commit -m "feat(docs-audit): DOCS_AUDIT_PR payload + applier (octokit docs PR)"`

---

## Task 7: AutopilotTaskResult.preview + task 가 preview 산출

**Files:**
- Modify: `src/autopilot/domain/autopilot-task.port.ts`
- Modify: `src/morning-briefing/domain/port/slack-notifier.port.ts`
- Modify: `src/docs-audit/docs-audit.module.ts`
- Modify: `src/docs-audit/application/run-docs-audit.usecase.ts` (revision 노출)
- Modify: `src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.ts`
- Modify: `src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.spec.ts`

**Interfaces:**
- Produces: `AutopilotTaskResult.preview?: AutopilotPreviewRequest`, `SlackNotifierPort.postPreviewMessage`
- Consumes: `DocsRevisionApplier`(Task 5), `DocsAuditResult.proposals`

- [ ] **Step 1: port 확장** — `autopilot-task.port.ts`:

```ts
import { PreviewKind } from '../../preview-gate/domain/preview-action.type';

// T1_PREVIEW task 가 orchestrator 에 올리는 preview 생성 요청. orchestrator 가 CreatePreviewUsecase 로 변환.
export interface AutopilotPreviewRequest {
  kind: PreviewKind;
  payload: unknown;
  previewText: string;
}

export interface AutopilotTaskResult {
  skip: boolean;
  slackText?: string;
  // T1_PREVIEW 전용 — 있으면 orchestrator 가 PreviewGate 승인 버튼 발송.
  preview?: AutopilotPreviewRequest;
}
```

- [ ] **Step 2: SlackNotifierPort 확장** — `slack-notifier.port.ts`:

```ts
export interface SlackNotifierPort {
  postMessage(input: { target: string; text: string }): Promise<void>;
  // T1_PREVIEW preview 버튼 메시지 (SlackService 가 이미 구현 — 인터페이스만 확장).
  postPreviewMessage(input: {
    target: string;
    previewText: string;
    previewId: string;
  }): Promise<void>;
}
```

- [ ] **Step 3: run-docs-audit 가 revision 산출** — `RunDocsAuditUseCase` 에 `DocsRevisionApplier`(Task 5) 주입(생성자 마지막 인자) + Task 4 의 `revision: null` 을 실제 산출로 교체. `DocsRevision`/`DocsAuditResult.revision` 은 이미 port 에 정의됨(Task 1):

```ts
// run-docs-audit.usecase.ts: runAudit 끝부분.
const confirmed = proposals.filter((proposal) => proposal.confirmed);
const revision =
  confirmed.length > 0 ? await this.revisionApplier.buildRevision(confirmed) : null;
return { deterministic, proposals, revision };
```

생성자: `..., private readonly revisionApplier: DocsRevisionApplier`. import `DocsRevisionApplier` from `../infrastructure/docs-revision.applier`.

- [ ] **Step 4: 모듈 wiring** — `docs-audit.module.ts`: full-doc reader 정의 + `DocsRevisionApplier` provider + `RunDocsAuditUseCase` factory 에 주입:

```ts
const fullDocReader: FullDocReader = async (path) => {
  try {
    return await readFile(join(process.cwd(), path), 'utf8');
  } catch {
    return '';
  }
};
// providers 에:
{ provide: DocsRevisionApplier, useValue: new DocsRevisionApplier(fullDocReader) },
// DOCS_AUDIT_PORT useFactory 에 DocsRevisionApplier 주입 추가 + inject 배열에 추가 + RunDocsAuditUseCase 생성자에 전달.
```

`RunDocsAuditUseCase` 생성자에 `private readonly revisionApplier: DocsRevisionApplier` 추가(마지막 인자). Task 4 spec 의 `build()` 도 7번째 인자로 mock 추가:

```ts
const build = (d:any) => new RunDocsAuditUseCase(d.checker, d.gitFiles, d.judge, d.reader, d.maxFiles, d.maxIterations, d.revisionApplier ?? { buildRevision: jest.fn().mockResolvedValue(null) });
```

- [ ] **Step 5: task 실패 테스트 갱신** — `docs-sync-audit.autopilot-task.spec.ts` 에 preview 분기 추가:

```ts
const ctx = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-29' };

it('DOCS_AUDIT_PR_ENABLED=true + revision 있으면 preview 페이로드 반환', async () => {
  const audit = { runAudit: jest.fn().mockResolvedValue({
    deterministic: { inSync: true, details: [] }, proposals: [],
    revision: { files: [{ path: 'README.md', content: 'new' }], changedFiles: ['README.md'], previewText: '편집 요약' },
  }) };
  const config = { get: jest.fn((k: string) => k === 'DOCS_AUDIT_PR_ENABLED' ? 'true' : (k === 'DOCS_AUDIT_PR_BASE_BRANCH' ? 'main' : (k === 'DOCS_AUDIT_PR_REPO' ? 'JSL107/personal_agents' : undefined))) };
  const task = new DocsSyncAuditTask(audit as any, config as any);
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.preview?.kind).toBe('DOCS_AUDIT_PR');
  expect((result.preview?.payload as any).files).toEqual([{ path: 'README.md', content: 'new' }]);
  expect((result.preview?.payload as any).repoLabel).toBe('JSL107/personal_agents');
});

it('DOCS_AUDIT_PR_ENABLED 미설정이면 preview 없이 기존 텍스트 경로', async () => {
  const audit = { runAudit: jest.fn().mockResolvedValue({
    deterministic: { inSync: false, details: ['docs:check FAIL'] }, proposals: [], revision: null,
  }) };
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const result = await new DocsSyncAuditTask(audit as any, config as any).run(ctx);
  expect(result.preview).toBeUndefined();
  expect(result.slackText).toContain('docs:check');
});
```

기존 `DOCS_AUDIT_ENABLED='false'` skip 테스트는 유지.

- [ ] **Step 6: task 구현 수정** — `docs-sync-audit.autopilot-task.ts`:

```ts
async run({ firedAtKst }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
  if (this.configService.get<string>('DOCS_AUDIT_ENABLED') === 'false') {
    return { skip: true };
  }
  const result = await this.audit.runAudit();
  const slackText = formatDocsAudit(result, firedAtKst);

  // 완전자동 게이트 ON + 적용 가능한 revision 이 있으면 preview 페이로드.
  if (
    this.configService.get<string>('DOCS_AUDIT_PR_ENABLED') === 'true' &&
    result.revision
  ) {
    const repoLabel =
      this.configService.get<string>('DOCS_AUDIT_PR_REPO')?.trim() ||
      this.configService.get<string>('BE_SANDBOX_DEFAULT_REPO_LABEL')?.trim() ||
      'JSL107/personal_agents';
    const baseBranch =
      this.configService.get<string>('DOCS_AUDIT_PR_BASE_BRANCH')?.trim() || 'main';
    const payload = {
      files: result.revision.files,
      changedFiles: result.revision.changedFiles,
      rationale: result.proposals.filter((p) => p.confirmed).map((p) => p.rationale).join('\n\n'),
      repoLabel,
      baseBranch,
    };
    return {
      skip: false,
      slackText: slackText.length > 0 ? slackText : undefined,
      preview: {
        kind: PREVIEW_KIND.DOCS_AUDIT_PR,
        payload,
        previewText: `${slackText}\n\n*적용 미리보기*\n${result.revision.previewText}\n\n✅ 적용 시 docs PR 이 열립니다.`,
      },
    };
  }

  if (slackText.length === 0) {
    return { skip: true };
  }
  return { skip: false, slackText };
}
```

import 에 `PREVIEW_KIND` 추가. `DocsSyncAuditTask` 는 ConfigService 만 추가 의존(이미 있음).

- [ ] **Step 7: 테스트 → PASS** (task + run-docs-audit 회귀).
- [ ] **Step 8: Commit**(승인 시) — `git commit -m "feat(autopilot): AutopilotTaskResult.preview + docs-sync-audit preview 산출"`

---

## Task 8: orchestrator T1_PREVIEW + 등록 + env

**Files:**
- Modify: `src/autopilot/application/autopilot.orchestrator.ts`
- Modify: `src/autopilot/application/autopilot.orchestrator.spec.ts`
- Modify: `src/autopilot/autopilot.module.ts`
- Modify: `src/autopilot/domain/autopilot.playbook.ts`
- Modify: `src/app.module.ts`
- Modify: `src/config/app.config.ts`, `.env.example`, `.env`

**Interfaces:**
- Consumes: `CreatePreviewUsecase`(전역), `SlackNotifierPort.postPreviewMessage`, `AutopilotTaskResult.preview`

- [ ] **Step 1: orchestrator 실패 테스트** — `autopilot.orchestrator.spec.ts` 에 T1_PREVIEW 케이스 추가(기존 spec 스타일 따라; CreatePreviewUsecase + slackNotifier mock):

```ts
it('T1_PREVIEW + preview 페이로드 → CreatePreview + postPreviewMessage(버튼)', async () => {
  const previewTask = { id: 'docs-sync-audit', run: jest.fn().mockResolvedValue({
    skip: false,
    preview: { kind: 'DOCS_AUDIT_PR', payload: { files: [] }, previewText: 'pv' },
  }) };
  const createPreview = { execute: jest.fn().mockResolvedValue({ id: 'PV1' }) };
  const slackNotifier = { postMessage: jest.fn(), postPreviewMessage: jest.fn() };
  const idempotency = { acquireOnce: jest.fn().mockResolvedValue(true) };
  const orchestrator = new AutopilotOrchestrator([previewTask] as any, slackNotifier as any, idempotency as any, createPreview as any);
  await orchestrator.runGroup('docs-sync-audit',
    [{ id: 'docs-sync-audit', taskId: 'docs-sync-audit', riskTier: 'T1_PREVIEW', trigger: { kind: 'CRON', schedule: '0 11 * * 0', timezone: 'Asia/Seoul' } }] as any,
    'U1', 'U1');
  expect(createPreview.execute).toHaveBeenCalledTimes(1);
  expect(createPreview.execute.mock.calls[0][0].kind).toBe('DOCS_AUDIT_PR');
  expect(createPreview.execute.mock.calls[0][0].slackUserId).toBe('U1');
  expect(slackNotifier.postPreviewMessage).toHaveBeenCalledWith({ target: 'U1', previewText: 'pv', previewId: 'PV1' });
});
```

기존 T0_AUTO 테스트들은 생성자에 `createPreview` 4번째 인자 추가(`{ execute: jest.fn() }`)로 갱신. **기존에 `riskTier !== 'T0_AUTO'` throw(`T1_PREVIEW 전달은 SP4 — 미지원`)를 단언하는 테스트가 있으면 삭제**(Task 8 에서 throw 제거).

- [ ] **Step 2: 테스트 → FAIL**.

- [ ] **Step 3: orchestrator 구현** — T1_PREVIEW 분기. 생성자에 `CreatePreviewUsecase` 주입. T0_AUTO 의 throw 를 제거하고 분기:

```ts
import { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import { AutopilotPreviewRequest } from '../domain/autopilot-task.port';

const PREVIEW_TTL_MS = 60 * 60 * 1000;

// 생성자에 추가:
//   private readonly createPreview: CreatePreviewUsecase,

async runGroup(groupKey, entries, ownerSlackUserId, target): Promise<void> {
  const firedAtKst = getTodayKstDate();
  const parts: string[] = [];
  const previews: AutopilotPreviewRequest[] = [];

  for (const entry of entries) {
    const task = this.tasks.get(entry.taskId);
    if (!task) {
      throw new Error(`Autopilot: task 미등록 — taskId=${entry.taskId}`);
    }
    try {
      const result = await task.run({ ownerSlackUserId, firedAtKst });
      if (result.preview) {
        previews.push(result.preview);
      }
      if (!result.skip && result.slackText) {
        parts.push(result.slackText);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Autopilot[${groupKey}] task '${entry.taskId}' 실패 (그룹은 계속): ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      parts.push(`_⚠️ ${entry.taskId} 자동 생성 실패 — ${message.slice(0, 200)}. 다음 슬롯에 재시도됩니다._`);
    }
  }

  if (parts.length === 0 && previews.length === 0) {
    this.logger.log(`Autopilot[${groupKey}] — 보고 내용 없음, 전달 skip`);
    return;
  }

  const firstRun = await this.cronIdempotency.acquireOnce(
    `autopilot:${groupKey}:${firedAtKst}`,
    CRON_SENT_GUARD_TTL_SECONDS,
  );
  if (!firstRun) {
    this.logger.warn(`Autopilot[${groupKey}] — ${firedAtKst} 이미 발송됨, 중복 차단`);
    return;
  }

  const targets = target.split(',').map((resolved) => resolved.trim()).filter((resolved) => resolved.length > 0);

  if (parts.length > 0) {
    const text = parts.join('\n\n────────\n\n');
    for (const resolved of targets) {
      await this.slackNotifier.postMessage({ target: resolved, text });
    }
  }

  // T1_PREVIEW — preview 별로 PENDING 생성 + 버튼 메시지(각 타깃).
  for (const preview of previews) {
    const created = await this.createPreview.execute({
      slackUserId: ownerSlackUserId,
      kind: preview.kind,
      payload: preview.payload,
      previewText: preview.previewText,
      responseUrl: null,
      ttlMs: PREVIEW_TTL_MS,
    });
    for (const resolved of targets) {
      await this.slackNotifier.postPreviewMessage({
        target: resolved,
        previewText: preview.previewText,
        previewId: created.id,
      });
    }
  }

  this.logger.log(`Autopilot[${groupKey}] — 발송 완료 ${targets.length}건 (${entries.length} task, preview ${previews.length})`);
}
```

> riskTier 설정 오류 fail-fast(T0_AUTO 가 아닌데 preview 도 없는 경우)는 제거 — preview 없으면 자연히 텍스트 경로. (게이트 OFF 시 docs-sync-audit 가 텍스트만 반환하므로 T1_PREVIEW 엔트리여도 정상.)

- [ ] **Step 4: 테스트 → PASS**.

- [ ] **Step 5: 모듈 wiring** — `autopilot.module.ts`: `AutopilotOrchestrator` 가 `CreatePreviewUsecase` 주입받도록(PreviewGateModule @Global 이라 import 불필요, providers 의 AutopilotOrchestrator 가 자동 주입). 명시 import 가 필요하면 `imports` 에 PreviewGate 노출 확인. 빌드로 검증.

- [ ] **Step 6: applier 등록** — `app.module.ts` 의 `PreviewGateModule.forRoot([...])` 배열에 `DocsAuditPrApplier` 추가 + import. DocsAuditModule 이 `DocsAuditPrApplier` 를 export 하거나, app.module 이 직접 provider 등록(BeSandboxPushPrApplier 패턴 확인 후 동일하게). DocsAuditModule providers/exports 에 `DocsAuditPrApplier` 추가.

- [ ] **Step 7: 플레이북 riskTier** — `autopilot.playbook.ts` 의 docs-sync-audit entry `riskTier: 'T1_PREVIEW'` 로 변경. (게이트 OFF 시 텍스트 폴백이라 안전.) `autopilot.playbook.spec.ts` 의 docs-sync-audit 단언을 `T1_PREVIEW` 로 갱신.

- [ ] **Step 8: env 4곳 동기** — `app.config.ts` 에 추가:

```ts
  // docs-sync-audit Phase 2 — 확정 제안 docs PR 자동 개설.
  // DOCS_AUDIT_PR_ENABLED: 'true' 일 때만 preview→PR. 미설정 시 Phase 1 텍스트 보고.
  @IsOptional()
  @IsString()
  DOCS_AUDIT_PR_ENABLED?: string;

  // DOCS_AUDIT_PR_REPO: docs PR 대상 "owner/repo". 미설정 시 BE_SANDBOX_DEFAULT_REPO_LABEL → "JSL107/personal_agents".
  @IsOptional()
  @IsString()
  @Matches(/^[^/\s]+\/[^/\s]+$/, { message: 'DOCS_AUDIT_PR_REPO 는 "owner/repo" 형식이어야 합니다.' })
  DOCS_AUDIT_PR_REPO?: string;

  // DOCS_AUDIT_PR_BASE_BRANCH: PR base. 미설정 시 main.
  @IsOptional()
  @IsString()
  DOCS_AUDIT_PR_BASE_BRANCH?: string;
```

`.env.example` + `.env` 에 주석 블록 추가(`cat >>`). `pnpm docs:sync` 로 env-catalog 재생성.

- [ ] **Step 9: Commit**(승인 시) — `git commit -m "feat(autopilot): orchestrator T1_PREVIEW + docs-sync-audit PR 등록 + env"`

---

## Task 9: 통합 검증

- [ ] **Step 1: docs:sync** — `pnpm docs:sync` (env-catalog 갱신; 새 AgentType 없음 — agent-catalog 무변).
- [ ] **Step 2: 3중 green + docs:check**:

```bash
pnpm lint:check && pnpm test && pnpm build
pnpm docs:check
```

Expected: 모두 exit 0. 실패 시 fix 후 재실행.

- [ ] **Step 3: 회귀 확인** — autopilot 부팅 `validatePlaybook` 통과(docs-sync-audit T1_PREVIEW). PreviewGate applier resolve(`DOCS_AUDIT_PR`) 등록 확인.
- [ ] **Step 4: Commit**(승인 시) — `git commit -m "chore(docs-audit): Phase 2 통합 검증 + 카탈로그 동기"`

---

## 검증 체크리스트 (완료 게이트)

- [ ] `pnpm lint:check` exit 0
- [ ] `pnpm test` exit 0 (신규/갱신 spec: applier, pr-applier, run-docs-audit, task, orchestrator)
- [ ] `pnpm build` exit 0
- [ ] `pnpm docs:check` exit 0
- [ ] `DOCS_AUDIT_PR_ENABLED` 미설정 시 Phase 1 텍스트 보고 그대로(회귀 없음)
- [ ] 승인 없이 PR 안 열림(PreviewGate PENDING) + main 직접 push 없음(applier 새 branch)

## Phase 3 (범위 밖)

- 다중 대상 문서(CLAUDE.md/AGENTS.md) 매핑 확장.
- 실제 codex E2E + 주간 cron 실발화 관찰.
- PR 자동 머지/CI 연동.
