# docs-sync-audit 자율 루프 구현 계획 (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문서↔코드 동기화를 두 레이어(결정론 게이트 + LLM 자기수정 루프)로 점검하는 읽기 전용 주간 autopilot task `docs-sync-audit`를 추가한다.

**Architecture:** knowledge-lint 형제 패턴. 신규 `src/docs-audit/` 모듈이 Layer 1(자식 프로세스로 `docs:check`/`check:env` 실행, 결정론)과 Layer 2(codex optimizer↔evaluator 자기수정 루프)를 캡슐화하고, `DocsSyncAuditTask`가 `AutopilotTask`로 노출. 파일을 절대 쓰지 않으므로 `riskTier: 'T0_AUTO'`로 기존 오케스트레이터에서 바로 동작.

**Tech Stack:** NestJS 10, TypeScript, codex CLI via `ModelRouterUsecase`, `@nestjs/config`, BullMQ(autopilot cron), Jest.

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` — `npm`/`yarn` 금지.
- ORM은 Prisma만. `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- LLM 호출은 `ModelRouterUsecase.route(...)` 경유만 (직접 SDK/argv 금지, prompt는 model-router가 stdin 처리).
- 코드 스타일(CODE_RULES): `catch (error)`, `const found`, 단일 if도 중괄호, try 안 `return await`, 인라인 반환 타입 금지, 파일명 kebab-case + role suffix.
- 완료 기준: `pnpm lint:check && pnpm test && pnpm build` 3중 green + `pnpm docs:check` OK.
- **커밋은 사용자 명시 요청 후에만** (CLAUDE.md §2 #1). 아래 각 Task의 "Commit" 스텝은 사용자가 커밋을 승인한 경우에만 실행 — 미승인 시 변경만 누적하고 보고.
- 새 env 추가 시 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts` + README.

---

## File Structure

**생성:**
- `src/docs-audit/domain/port/docs-audit.port.ts` — 포트 + 결과 타입 (Layer1/Layer2)
- `src/docs-audit/domain/prompt/docs-audit.prompt.ts` — optimizer/evaluator 프롬프트 빌더
- `src/docs-audit/application/run-docs-audit.usecase.ts` — 자율 루프 본체 (Layer1 + Layer2 반복)
- `src/docs-audit/infrastructure/deterministic-docs.checker.ts` — `docs:check`/`check:env` 자식 프로세스
- `src/docs-audit/infrastructure/git-changed-files.provider.ts` — 최근 git 변경 SoT 파일 수집
- `src/docs-audit/infrastructure/codex-docs-judge.adapter.ts` — optimizer/evaluator codex 호출
- `src/docs-audit/docs-audit.module.ts` — 모듈 wiring
- `src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.ts` — AutopilotTask 구현
- `src/slack/format/docs-audit.formatter.ts` — slackText 렌더
- 각 파일의 `*.spec.ts`

**수정:**
- `src/model-router/domain/model-router.type.ts` — `AgentType` 2개 추가
- `src/model-router/application/model-router.usecase.ts` — `AGENT_TO_PROVIDER` 2줄
- `src/autopilot/domain/autopilot.playbook-defaults.ts` — `DEFAULT_DOCS_AUDIT_CRON`/`_TIMEZONE`
- `src/autopilot/domain/autopilot.playbook.ts` — 플레이북 항목
- `src/autopilot/autopilot.module.ts` — task provider 등록 + `DocsAuditModule` import
- `src/config/app.config.ts` — env 4종
- `.env.example`, `.env`, `README.md`

---

## Task 1: AgentType + 모델 매핑 추가

**Files:**
- Modify: `src/model-router/domain/model-router.type.ts:47` (CONTRADICTION_JUDGE 아래)
- Modify: `src/model-router/application/model-router.usecase.ts:53` (CONTRADICTION_JUDGE 매핑 아래)
- Test: `src/model-router/application/model-router.usecase.spec.ts` (기존 파일에 추가)

**Interfaces:**
- Produces: `AgentType.DOCS_AUDIT_OPTIMIZER`, `AgentType.DOCS_AUDIT_EVALUATOR` (둘 다 `ModelProviderName.CHATGPT` 라우팅)

- [ ] **Step 1: enum 멤버 추가** — `model-router.type.ts`의 `CONTRADICTION_JUDGE = 'CONTRADICTION_JUDGE',` 다음 줄에:

```ts
  // docs-sync-audit Layer 2 — 문서 의미 드리프트 자기수정 루프. 둘 다 경량 판정 → ChatGPT.
  // optimizer: 코드 변경 기준 문서 수정안 생성 / evaluator: 그 수정안이 코드와 일치하는지 채점.
  // 슬래시/ResponseCode/retry-run 비대상 (내부 루프 전용 — CONTRADICTION_JUDGE 선례).
  DOCS_AUDIT_OPTIMIZER = 'DOCS_AUDIT_OPTIMIZER',
  DOCS_AUDIT_EVALUATOR = 'DOCS_AUDIT_EVALUATOR',
```

- [ ] **Step 2: AGENT_TO_PROVIDER 매핑 추가** — `model-router.usecase.ts`의 `[AgentType.CONTRADICTION_JUDGE]: ModelProviderName.CHATGPT,` 다음 줄에:

```ts
  // docs-sync-audit Layer 2 — 문서 의미 드리프트 optimizer/evaluator. 경량 → ChatGPT.
  [AgentType.DOCS_AUDIT_OPTIMIZER]: ModelProviderName.CHATGPT,
  [AgentType.DOCS_AUDIT_EVALUATOR]: ModelProviderName.CHATGPT,
```

> `AGENT_TO_PROVIDER`는 `Record<AgentType, ...>` exhaustive라, enum만 추가하고 매핑을 빠뜨리면 빌드가 깨진다(의도된 안전장치).

- [ ] **Step 3: 라우팅 테스트 추가** — `model-router.usecase.spec.ts`에 (기존 spec 스타일 따라):

```ts
it('docs-audit optimizer/evaluator 는 CHATGPT 로 라우팅된다', async () => {
  // chatgptProvider.complete 가 호출되는지로 검증 (기존 spec 의 provider mock 패턴 재사용)
  await usecase.route({
    agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
    request: { prompt: 'p' },
  });
  expect(chatgptProvider.complete).toHaveBeenCalledTimes(1);
  expect(claudeProvider.complete).not.toHaveBeenCalled();
});
```

- [ ] **Step 4: 테스트 실행** — `pnpm test -- model-router.usecase` → PASS. `pnpm build` → 타입 OK.

- [ ] **Step 5: Commit** (승인 시) — `git commit -m "feat(model-router): docs-audit optimizer/evaluator agentType 추가"`

---

## Task 2: docs-audit 도메인 포트 + 결과 타입

**Files:**
- Create: `src/docs-audit/domain/port/docs-audit.port.ts`

**Interfaces:**
- Produces: `DOCS_AUDIT_PORT`, `DocsAuditPort.runAudit()`, 타입 `DeterministicDriftReport`, `DocsRevisionProposal`, `DocsAuditResult`, `OptimizerOutput`, `EvaluatorVerdict`

- [ ] **Step 1: 포트·타입 작성** (이 파일은 순수 선언 — 컴파일로 검증, 별도 단위 테스트 없음. 소비 테스트는 Task 6에서):

```ts
// docs-sync-audit 포트 — 문서↔코드 동기화 점검 결과. autopilot task 가 소비.

// Layer 1: 결정론 게이트 (docs:check / check:env).
export interface DeterministicDriftReport {
  // drift 가 있으면 false. 깨끗하면 true.
  inSync: boolean;
  // 드리프트 명령별 사람이 읽는 사유 (예: "docs:check FAIL — docs/agent-catalog.md").
  details: string[];
}

// Layer 2: optimizer 단일 산출.
export interface OptimizerOutput {
  // 수정 필요 없음이면 false (이 파일은 코드와 일치).
  needsRevision: boolean;
  filePath: string;
  // 제안 수정 설명 + 발췌 diff (적용은 Phase 2 — 여기선 텍스트).
  proposedDiff: string;
  rationale: string;
}

// Layer 2: evaluator 채점.
export interface EvaluatorVerdict {
  pass: boolean;
  score: number; // 0-100
  feedback: string;
}

// Layer 2: 루프가 확정한 검증된 제안.
export interface DocsRevisionProposal {
  filePath: string;
  proposedDiff: string;
  rationale: string;
  score: number;
  // green 종료(true) vs 반복캡/Circuit Breaker 로 미확정 종료(false).
  confirmed: boolean;
}

export interface DocsAuditResult {
  deterministic: DeterministicDriftReport;
  proposals: DocsRevisionProposal[];
}

export interface DocsAuditPort {
  runAudit(): Promise<DocsAuditResult>;
}

export const DOCS_AUDIT_PORT = Symbol('DOCS_AUDIT_PORT');
```

- [ ] **Step 2: 빌드 확인** — `pnpm build` → 타입 OK.

- [ ] **Step 3: Commit** (승인 시) — `git commit -m "feat(docs-audit): 도메인 포트·결과 타입 정의"`

---

## Task 3: 결정론 checker (Layer 1)

**Files:**
- Create: `src/docs-audit/infrastructure/deterministic-docs.checker.ts`
- Test: `src/docs-audit/infrastructure/deterministic-docs.checker.spec.ts`

**Interfaces:**
- Consumes: `DeterministicDriftReport` (Task 2)
- Produces: `DeterministicDocsChecker.check(): Promise<DeterministicDriftReport>`

설계: `pnpm docs:check`와 `pnpm check:env`를 자식 프로세스로 실행. exit 0 = in sync. 비-0 = drift. `child_process.spawn`을 주입 가능한 함수로 감싸 테스트한다.

- [ ] **Step 1: 실패 테스트 작성**:

```ts
import { DeterministicDocsChecker } from './deterministic-docs.checker';

describe('DeterministicDocsChecker', () => {
  it('모든 명령 exit 0 이면 inSync=true', async () => {
    const runner = jest.fn().mockResolvedValue({ exitCode: 0, output: 'OK' });
    const checker = new DeterministicDocsChecker(runner);
    const report = await checker.check();
    expect(report.inSync).toBe(true);
    expect(report.details).toHaveLength(0);
  });

  it('docs:check 가 exit 1 이면 inSync=false + 사유 수집', async () => {
    const runner = jest
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, output: 'FAIL: docs/agent-catalog.md' })
      .mockResolvedValueOnce({ exitCode: 0, output: 'OK' });
    const checker = new DeterministicDocsChecker(runner);
    const report = await checker.check();
    expect(report.inSync).toBe(false);
    expect(report.details[0]).toContain('docs:check');
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL** (`Cannot find module './deterministic-docs.checker'`).

- [ ] **Step 3: 구현 작성**:

```ts
import { spawn } from 'node:child_process';

import { Injectable } from '@nestjs/common';

import { DeterministicDriftReport } from '../domain/port/docs-audit.port';

interface CommandResult {
  exitCode: number;
  output: string;
}

// 주입 가능한 명령 실행기 — 테스트에서 mock.
export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

const DEFAULT_RUNNER: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    child.on('close', (code) => {
      resolve({ exitCode: code ?? 1, output });
    });
  });

const CHECKS: ReadonlyArray<{ label: string; args: string[] }> = [
  { label: 'docs:check', args: ['docs:check'] },
  { label: 'check:env', args: ['check:env'] },
];

@Injectable()
export class DeterministicDocsChecker {
  constructor(private readonly runner: CommandRunner = DEFAULT_RUNNER) {}

  async check(): Promise<DeterministicDriftReport> {
    const details: string[] = [];
    for (const { label, args } of CHECKS) {
      const result = await this.runner('pnpm', args);
      if (result.exitCode !== 0) {
        details.push(`${label} FAIL — ${result.output.slice(0, 300).trim()}`);
      }
    }
    return { inSync: details.length === 0, details };
  }
}
```

> 주의: 생성자 default 값은 함수라 reflection 이 타입을 못 잡는 문제 없음(§6 Number 함정은 primitive 한정). `CommandRunner`는 타입이라 DI 토큰 충돌 없음 — Task 7에서 provider 등록 시 default 사용.

- [ ] **Step 4: 테스트 실행 → PASS** (`pnpm test -- deterministic-docs.checker`).

- [ ] **Step 5: Commit** (승인 시) — `git commit -m "feat(docs-audit): Layer1 결정론 checker (docs:check/check:env)"`

---

## Task 4: optimizer/evaluator 프롬프트 + codex adapter (Layer 2 LLM)

**Files:**
- Create: `src/docs-audit/domain/prompt/docs-audit.prompt.ts`
- Create: `src/docs-audit/infrastructure/codex-docs-judge.adapter.ts`
- Test: `src/docs-audit/infrastructure/codex-docs-judge.adapter.spec.ts`

**Interfaces:**
- Consumes: `OptimizerOutput`, `EvaluatorVerdict` (Task 2), `ModelRouterUsecase.route` (codex)
- Produces: `CodexDocsJudgeAdapter.optimize(input)`, `.evaluate(input)`

- [ ] **Step 1: 프롬프트 빌더 작성** (`docs-audit.prompt.ts`):

```ts
export const OPTIMIZER_SYSTEM_PROMPT =
  '당신은 코드 변경과 문서를 대조해 "문서가 코드와 의미적으로 어긋났는지" 판정하고, ' +
  '어긋났으면 최소 수정안을 제안하는 기술 문서 검수자입니다. ' +
  '코드 사실만 근거로 삼고, 추측하지 마세요. 반드시 아래 JSON 한 개만 출력합니다.\n' +
  '{"needsRevision": boolean, "proposedDiff": string, "rationale": string}';

export function buildOptimizerPrompt(input: {
  filePath: string;
  codeContext: string;
  docExcerpt: string;
  evaluatorFeedback?: string;
}): string {
  const feedback = input.evaluatorFeedback
    ? `\n\n[직전 평가자 피드백 — 이를 반영해 다시 제안]\n${input.evaluatorFeedback}`
    : '';
  return [
    `[대상 문서] ${input.filePath}`,
    `[관련 코드(SoT) 발췌]\n${input.codeContext}`,
    `[현재 문서 발췌]\n${input.docExcerpt}`,
    '위 코드 기준으로 문서 발췌가 사실과 어긋났는지 판정하고, 어긋났으면 수정안을 제안하세요.',
    feedback,
  ].join('\n\n');
}

export const EVALUATOR_SYSTEM_PROMPT =
  '당신은 문서 수정 제안을 코드 사실과 대조해 채점하는 엄격한 평가자입니다. ' +
  '제안이 코드와 정확히 일치하고 과/부족 수정이 없을 때만 pass=true. 의심되면 pass=false. ' +
  '반드시 아래 JSON 한 개만 출력합니다.\n' +
  '{"pass": boolean, "score": number(0-100), "feedback": string}';

export function buildEvaluatorPrompt(input: {
  filePath: string;
  codeContext: string;
  proposedDiff: string;
}): string {
  return [
    `[대상 문서] ${input.filePath}`,
    `[관련 코드(SoT) 발췌]\n${input.codeContext}`,
    `[제안된 수정]\n${input.proposedDiff}`,
    '이 수정안이 코드 사실과 정확히 일치하는지 채점하세요. 과수정/부족수정도 감점하세요.',
  ].join('\n\n');
}
```

- [ ] **Step 2: adapter 실패 테스트 작성** (`codex-docs-judge.adapter.spec.ts`) — judge-contradiction.usecase.spec 패턴 미러:

```ts
import { CodexDocsJudgeAdapter } from './codex-docs-judge.adapter';

describe('CodexDocsJudgeAdapter', () => {
  const makeRouter = (text: string) =>
    ({ route: jest.fn().mockResolvedValue({ text }) }) as any;

  it('optimize: codex JSON 응답을 OptimizerOutput 으로 파싱', async () => {
    const router = makeRouter('{"needsRevision": true, "proposedDiff": "d", "rationale": "r"}');
    const adapter = new CodexDocsJudgeAdapter(router);
    const out = await adapter.optimize({ filePath: 'README.md', codeContext: 'c', docExcerpt: 'd' });
    expect(out.needsRevision).toBe(true);
    expect(out.filePath).toBe('README.md');
  });

  it('evaluate: pass/score 파싱', async () => {
    const router = makeRouter('{"pass": true, "score": 95, "feedback": "ok"}');
    const adapter = new CodexDocsJudgeAdapter(router);
    const verdict = await adapter.evaluate({ filePath: 'README.md', codeContext: 'c', proposedDiff: 'd' });
    expect(verdict).toEqual({ pass: true, score: 95, feedback: 'ok' });
  });

  it('JSON 없는 응답은 안전 기본값(needsRevision=false / pass=false)', async () => {
    const adapter = new CodexDocsJudgeAdapter(makeRouter('주절주절'));
    expect((await adapter.optimize({ filePath: 'x', codeContext: '', docExcerpt: '' })).needsRevision).toBe(false);
    expect((await adapter.evaluate({ filePath: 'x', codeContext: '', proposedDiff: '' })).pass).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실행 → FAIL**.

- [ ] **Step 4: adapter 구현** (judge-contradiction.usecase.ts의 route 호출 + JSON 파싱 패턴 그대로):

```ts
import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  EvaluatorVerdict,
  OptimizerOutput,
} from '../domain/port/docs-audit.port';
import {
  buildEvaluatorPrompt,
  buildOptimizerPrompt,
  EVALUATOR_SYSTEM_PROMPT,
  OPTIMIZER_SYSTEM_PROMPT,
} from '../domain/prompt/docs-audit.prompt';

// Layer 2 LLM — codex(ChatGPT) optimizer/evaluator. model-router 경유(쿼터 소진은 route 가
// ModelRouterException 으로 감싸 전파 → usecase 에서 circuit break). JudgeContradictionUsecase 미러.
@Injectable()
export class CodexDocsJudgeAdapter {
  constructor(private readonly modelRouter: ModelRouterUsecase) {}

  async optimize(input: {
    filePath: string;
    codeContext: string;
    docExcerpt: string;
    evaluatorFeedback?: string;
  }): Promise<OptimizerOutput> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.DOCS_AUDIT_OPTIMIZER,
      request: {
        prompt: buildOptimizerPrompt(input),
        systemPrompt: OPTIMIZER_SYSTEM_PROMPT,
      },
    });
    const parsed = this.parseJson(completion.text);
    return {
      needsRevision: parsed?.needsRevision === true,
      filePath: input.filePath,
      proposedDiff: typeof parsed?.proposedDiff === 'string' ? parsed.proposedDiff : '',
      rationale: typeof parsed?.rationale === 'string' ? parsed.rationale : '',
    };
  }

  async evaluate(input: {
    filePath: string;
    codeContext: string;
    proposedDiff: string;
  }): Promise<EvaluatorVerdict> {
    const completion = await this.modelRouter.route({
      agentType: AgentType.DOCS_AUDIT_EVALUATOR,
      request: {
        prompt: buildEvaluatorPrompt(input),
        systemPrompt: EVALUATOR_SYSTEM_PROMPT,
      },
    });
    const parsed = this.parseJson(completion.text);
    const score = typeof parsed?.score === 'number' ? parsed.score : 0;
    return {
      pass: parsed?.pass === true,
      score,
      feedback: typeof parsed?.feedback === 'string' ? parsed.feedback : '',
    };
  }

  private parseJson(text: string): Record<string, unknown> | null {
    const match = text.match(/\{[\s\S]*\}/u);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
```

> 쿼터 소진: `route()`가 `ModelRouterException`(cause에 `CodexQuotaExceededException`)을 throw → adapter는 잡지 않고 전파. circuit break는 Task 6 usecase가 담당(쿼터 예외 = 즉시 루프 중단).

- [ ] **Step 5: 테스트 실행 → PASS**.

- [ ] **Step 6: Commit** (승인 시) — `git commit -m "feat(docs-audit): Layer2 codex optimizer/evaluator adapter + 프롬프트"`

---

## Task 5: 최근 git 변경 SoT 파일 수집

**Files:**
- Create: `src/docs-audit/infrastructure/git-changed-files.provider.ts`
- Test: `src/docs-audit/infrastructure/git-changed-files.provider.spec.ts`

**Interfaces:**
- Produces: `GitChangedFilesProvider.recentlyChangedSotFiles(maxFiles: number): Promise<string[]>`

설계: `git log --since=<기간> --name-only --pretty=format:` 결과에서 SoT 화이트리스트에 매칭되는 파일만 반환. `CommandRunner`(Task 3) 재사용.

- [ ] **Step 1: 실패 테스트**:

```ts
import { GitChangedFilesProvider } from './git-changed-files.provider';

describe('GitChangedFilesProvider', () => {
  it('SoT 화이트리스트에 든 변경 파일만, maxFiles 까지 반환', async () => {
    const runner = jest.fn().mockResolvedValue({
      exitCode: 0,
      output: [
        'src/agent-registry/agent-registry.ts',
        'src/config/app.config.ts',
        'src/some/unrelated.ts',
        'README.md',
      ].join('\n'),
    });
    const provider = new GitChangedFilesProvider(runner);
    const files = await provider.recentlyChangedSotFiles(5);
    expect(files).toContain('src/agent-registry/agent-registry.ts');
    expect(files).toContain('src/config/app.config.ts');
    expect(files).not.toContain('src/some/unrelated.ts');
  });
});
```

- [ ] **Step 2: 테스트 → FAIL**.

- [ ] **Step 3: 구현**:

```ts
import { Injectable } from '@nestjs/common';

import { CommandRunner } from './deterministic-docs.checker';

// 문서 드리프트를 잘 일으키는 SoT 파일 화이트리스트 — sync-docs.ts 의 생성 소스와 일치.
const SOT_WHITELIST: readonly string[] = [
  'src/agent-registry/agent-registry.ts',
  'src/config/app.config.ts',
  'src/model-router/application/model-router.usecase.ts',
];

const DEFAULT_GIT_RUNNER: CommandRunner = (command, args) =>
  // 실제 git 실행은 Task 3 의 DEFAULT_RUNNER 와 동일 패턴 — 여기선 주입받아 재사용한다.
  Promise.reject(new Error('GitChangedFilesProvider 는 runner 주입 필요'));

@Injectable()
export class GitChangedFilesProvider {
  constructor(private readonly runner: CommandRunner = DEFAULT_GIT_RUNNER) {}

  async recentlyChangedSotFiles(maxFiles: number): Promise<string[]> {
    const result = await this.runner('git', [
      'log',
      '--since=7 days ago',
      '--name-only',
      '--pretty=format:',
    ]);
    if (result.exitCode !== 0) {
      return [];
    }
    const changed = new Set(
      result.output
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    );
    return SOT_WHITELIST.filter((path) => changed.has(path)).slice(0, maxFiles);
  }
}
```

> Task 7에서 `DeterministicDocsChecker`와 동일한 `DEFAULT_RUNNER`를 공유 provider로 주입한다(중복 spawn 구현 회피 — DRY). 모듈에서 `GitChangedFilesProvider`를 `useFactory`로 만들며 공유 runner를 넘긴다.

- [ ] **Step 4: 테스트 → PASS**.

- [ ] **Step 5: Commit** (승인 시) — `git commit -m "feat(docs-audit): 최근 git 변경 SoT 파일 수집"`

---

## Task 6: RunDocsAuditUseCase — 자율 루프 본체 (핵심)

**Files:**
- Create: `src/docs-audit/application/run-docs-audit.usecase.ts`
- Test: `src/docs-audit/application/run-docs-audit.usecase.spec.ts`

**Interfaces:**
- Consumes: `DeterministicDocsChecker`(Task 3), `GitChangedFilesProvider`(Task 5), `CodexDocsJudgeAdapter`(Task 4), 타입(Task 2)
- Produces: `RunDocsAuditUseCase` implements `DocsAuditPort` (`runAudit()`)

설계 — 종료조건 3종(배운 패턴):
- **green**: evaluator `pass && score >= PASS_SCORE(90)` → 확정 제안.
- **Bounded Execution**: optimizer↔evaluator 반복 `maxIterations`(주입, 기본 3)회.
- **Circuit Breaker**: score가 직전 대비 개선 없으면(정체) 중단 → 미확정 제안.
- 쿼터 예외(`ModelRouterException` 전파)는 루프 전체 즉시 중단.

- [ ] **Step 1: 실패 테스트 (4 케이스)**:

```ts
import { RunDocsAuditUseCase } from './run-docs-audit.usecase';

const cleanDeterministic = { inSync: true, details: [] };

function makeDeps(over: Partial<any> = {}) {
  return {
    checker: { check: jest.fn().mockResolvedValue(cleanDeterministic) },
    gitFiles: { recentlyChangedSotFiles: jest.fn().mockResolvedValue(['README.md']) },
    judge: {
      optimize: jest.fn(),
      evaluate: jest.fn(),
    },
    fileReader: jest.fn().mockResolvedValue('문서/코드 발췌'),
    maxFiles: 5,
    maxIterations: 3,
    ...over,
  };
}

function build(deps: any) {
  return new RunDocsAuditUseCase(
    deps.checker, deps.gitFiles, deps.judge, deps.fileReader,
    deps.maxFiles, deps.maxIterations,
  );
}

it('(a) optimizer 1회 + evaluator green → 확정 제안 1건', async () => {
  const deps = makeDeps();
  deps.judge.optimize.mockResolvedValue({ needsRevision: true, filePath: 'README.md', proposedDiff: 'd', rationale: 'r' });
  deps.judge.evaluate.mockResolvedValue({ pass: true, score: 95, feedback: 'ok' });
  const result = await build(deps).runAudit();
  expect(result.proposals).toHaveLength(1);
  expect(result.proposals[0].confirmed).toBe(true);
  expect(deps.judge.optimize).toHaveBeenCalledTimes(1);
});

it('(b) 계속 미달 → maxIterations 회 후 미확정 종료', async () => {
  const deps = makeDeps({ maxIterations: 3 });
  deps.judge.optimize.mockResolvedValue({ needsRevision: true, filePath: 'README.md', proposedDiff: 'd', rationale: 'r' });
  deps.judge.evaluate
    .mockResolvedValueOnce({ pass: false, score: 50, feedback: 'f1' })
    .mockResolvedValueOnce({ pass: false, score: 60, feedback: 'f2' })
    .mockResolvedValueOnce({ pass: false, score: 70, feedback: 'f3' });
  const result = await build(deps).runAudit();
  expect(deps.judge.optimize).toHaveBeenCalledTimes(3);
  expect(result.proposals[0].confirmed).toBe(false);
});

it('(c) score 개선 없음 → Circuit Breaker 조기 중단', async () => {
  const deps = makeDeps({ maxIterations: 5 });
  deps.judge.optimize.mockResolvedValue({ needsRevision: true, filePath: 'README.md', proposedDiff: 'd', rationale: 'r' });
  deps.judge.evaluate.mockResolvedValue({ pass: false, score: 50, feedback: 'stuck' });
  await build(deps).runAudit();
  // 1회차(50) + 2회차(50, 개선없음 감지) → 3회차로 안 감
  expect(deps.judge.optimize).toHaveBeenCalledTimes(2);
});

it('(d) needsRevision=false → 제안 없음 (루프 진입 안 함)', async () => {
  const deps = makeDeps();
  deps.judge.optimize.mockResolvedValue({ needsRevision: false, filePath: 'README.md', proposedDiff: '', rationale: '' });
  const result = await build(deps).runAudit();
  expect(result.proposals).toHaveLength(0);
  expect(deps.judge.evaluate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 테스트 → FAIL**.

- [ ] **Step 3: 구현**:

```ts
import { Injectable } from '@nestjs/common';

import { CodexDocsJudgeAdapter } from '../infrastructure/codex-docs-judge.adapter';
import { DeterministicDocsChecker } from '../infrastructure/deterministic-docs.checker';
import { GitChangedFilesProvider } from '../infrastructure/git-changed-files.provider';
import {
  DocsAuditPort,
  DocsAuditResult,
  DocsRevisionProposal,
} from '../domain/port/docs-audit.port';

const PASS_SCORE = 90;

// 코드/문서 발췌 로더 — 테스트 주입용. 실제 구현은 모듈에서 fs.readFile 래퍼 주입.
export type DocExcerptReader = (filePath: string) => Promise<string>;

@Injectable()
export class RunDocsAuditUseCase implements DocsAuditPort {
  constructor(
    private readonly checker: DeterministicDocsChecker,
    private readonly gitFiles: GitChangedFilesProvider,
    private readonly judge: CodexDocsJudgeAdapter,
    private readonly readExcerpt: DocExcerptReader,
    private readonly maxFiles: number = 5,
    private readonly maxIterations: number = 3,
  ) {}

  async runAudit(): Promise<DocsAuditResult> {
    const deterministic = await this.checker.check();
    const files = await this.gitFiles.recentlyChangedSotFiles(this.maxFiles);

    const proposals: DocsRevisionProposal[] = [];
    for (const filePath of files) {
      const proposal = await this.auditOneFile(filePath);
      if (proposal) {
        proposals.push(proposal);
      }
    }
    return { deterministic, proposals };
  }

  // 한 파일에 대한 optimizer↔evaluator 자기수정 루프. 종료: green / maxIter / Circuit Breaker.
  private async auditOneFile(
    filePath: string,
  ): Promise<DocsRevisionProposal | null> {
    const codeContext = await this.readExcerpt(filePath);
    const docExcerpt = await this.readExcerpt(filePath);

    let feedback: string | undefined;
    let best: { proposedDiff: string; rationale: string; score: number } | null = null;
    let previousScore = -1;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      const optimized = await this.judge.optimize({
        filePath,
        codeContext,
        docExcerpt,
        evaluatorFeedback: feedback,
      });
      if (!optimized.needsRevision) {
        return null;
      }

      const verdict = await this.judge.evaluate({
        filePath,
        codeContext,
        proposedDiff: optimized.proposedDiff,
      });
      best = {
        proposedDiff: optimized.proposedDiff,
        rationale: optimized.rationale,
        score: verdict.score,
      };

      if (verdict.pass && verdict.score >= PASS_SCORE) {
        return { filePath, ...best, confirmed: true };
      }
      // Circuit Breaker — 개선 없으면(정체) 더 돌려도 무의미.
      if (iteration > 0 && verdict.score <= previousScore) {
        break;
      }
      previousScore = verdict.score;
      feedback = verdict.feedback;
    }

    // 반복캡/정체로 미확정 종료 — best 를 미확정 제안으로.
    return best ? { filePath, ...best, confirmed: false } : null;
  }
}
```

> **학습 포인트(코드 주석으로도 남길 것):** `auditOneFile`이 곧 evaluator-optimizer 루프다. 종료조건 3종이 한 함수에 다 보인다 — green(`return ... confirmed:true`), Bounded(`for < maxIterations`), Circuit Breaker(`score <= previousScore` break). 쿼터 예외는 `judge.*`가 throw하면 자연 전파되어 루프가 끊긴다.

- [ ] **Step 4: 테스트 → PASS** (4 케이스 모두).

- [ ] **Step 5: Commit** (승인 시) — `git commit -m "feat(docs-audit): 자율 루프 본체 (optimizer↔evaluator + 종료조건 3종)"`

---

## Task 7: DocsAuditModule wiring

**Files:**
- Create: `src/docs-audit/docs-audit.module.ts`
- Test: (모듈 컴파일 + Task 8 통합에서 검증)

**Interfaces:**
- Produces: `DocsAuditModule` (exports `DOCS_AUDIT_PORT` → `RunDocsAuditUseCase`)

- [ ] **Step 1: 공유 runner + fs reader 정의 후 모듈 작성**:

```ts
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ModelRouterModule } from '../model-router/model-router.module';
import {
  DocExcerptReader,
  RunDocsAuditUseCase,
} from './application/run-docs-audit.usecase';
import { DOCS_AUDIT_PORT } from './domain/port/docs-audit.port';
import { CodexDocsJudgeAdapter } from './infrastructure/codex-docs-judge.adapter';
import {
  CommandRunner,
  DeterministicDocsChecker,
} from './infrastructure/deterministic-docs.checker';
import { GitChangedFilesProvider } from './infrastructure/git-changed-files.provider';

// 모든 자식 프로세스(pnpm/git)를 도는 공유 runner — Checker/Git provider 가 공유(DRY).
const sharedRunner: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { cwd: process.cwd() });
    let output = '';
    child.stdout.on('data', (c) => (output += String(c)));
    child.stderr.on('data', (c) => (output += String(c)));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });

const fileExcerptReader: DocExcerptReader = async (filePath) => {
  try {
    const text = await readFile(join(process.cwd(), filePath), 'utf8');
    return text.slice(0, 8000); // 컨텍스트 가드 — 발췌만.
  } catch {
    return '';
  }
};

@Module({
  imports: [ModelRouterModule],
  providers: [
    CodexDocsJudgeAdapter,
    { provide: DeterministicDocsChecker, useValue: new DeterministicDocsChecker(sharedRunner) },
    { provide: GitChangedFilesProvider, useValue: new GitChangedFilesProvider(sharedRunner) },
    {
      provide: DOCS_AUDIT_PORT,
      useFactory: (
        judge: CodexDocsJudgeAdapter,
        checker: DeterministicDocsChecker,
        gitFiles: GitChangedFilesProvider,
        config: ConfigService,
      ) => {
        const maxFiles = Number(config.get('DOCS_AUDIT_MAX_FILES')) || 5;
        const maxIter = Number(config.get('DOCS_AUDIT_MAX_ITERATIONS')) || 3;
        return new RunDocsAuditUseCase(checker, gitFiles, judge, fileExcerptReader, maxFiles, maxIter);
      },
      inject: [CodexDocsJudgeAdapter, DeterministicDocsChecker, GitChangedFilesProvider, ConfigService],
    },
  ],
  exports: [DOCS_AUDIT_PORT],
})
export class DocsAuditModule {}
```

> `ModelRouterModule`이 `ModelRouterUsecase`를 export하는지 확인 — 안 하면 `CodexDocsJudgeAdapter` 주입이 깨진다. (knowledge-lint이 같은 방식으로 쓰므로 export되어 있을 것. 미export 시 `exports`에 추가.)

- [ ] **Step 2: 빌드 확인** — `pnpm build`. 주입 에러 없는지.

- [ ] **Step 3: Commit** (승인 시) — `git commit -m "feat(docs-audit): 모듈 wiring (공유 runner + ConfigService 가드)"`

---

## Task 8: AutopilotTask + formatter

**Files:**
- Create: `src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.ts`
- Create: `src/slack/format/docs-audit.formatter.ts`
- Test: `src/autopilot/infrastructure/tasks/docs-sync-audit.autopilot-task.spec.ts`, `src/slack/format/docs-audit.formatter.spec.ts`

**Interfaces:**
- Consumes: `DOCS_AUDIT_PORT`/`DocsAuditPort`(Task 2/6), `AutopilotTask`(기존), `ConfigService`
- Produces: `DocsSyncAuditTask` (id `'docs-sync-audit'`), `formatDocsAudit(result, firedAtKst)`

knowledge-lint task 패턴 미러: env 게이트(`DOCS_AUDIT_ENABLED !== 'false'`), 이슈 0건 → skip.

- [ ] **Step 1: formatter 실패 테스트**:

```ts
import { formatDocsAudit } from './docs-audit.formatter';

it('drift + 제안 있으면 mrkdwn 텍스트, 깨끗하면 빈 문자열', () => {
  const text = formatDocsAudit(
    { deterministic: { inSync: false, details: ['docs:check FAIL — agent-catalog'] },
      proposals: [{ filePath: 'README.md', proposedDiff: 'd', rationale: 'r', score: 95, confirmed: true }] },
    '2026-06-29',
  );
  expect(text).toContain('docs:check');
  expect(text).toContain('README.md');
  expect(formatDocsAudit({ deterministic: { inSync: true, details: [] }, proposals: [] }, '2026-06-29')).toBe('');
});
```

- [ ] **Step 2: formatter 구현**:

```ts
import { DocsAuditResult } from '../../docs-audit/domain/port/docs-audit.port';

// LLM/명령 출력에 mrkdwn 제어문자가 섞일 수 있어 백틱 코드블록으로 감싼다(escape 단순화).
export function formatDocsAudit(result: DocsAuditResult, firedAtKst: string): string {
  const lines: string[] = [];
  if (!result.deterministic.inSync) {
    lines.push('*📄 문서 드리프트(결정론)* — `pnpm docs:sync` 후 커밋하면 해결:');
    for (const detail of result.deterministic.details) {
      lines.push(`> \`${detail}\``);
    }
  }
  if (result.proposals.length > 0) {
    lines.push(`*🤖 문서 의미 드리프트 제안* (${firedAtKst}):`);
    for (const p of result.proposals) {
      const mark = p.confirmed ? '✅ 검증됨' : '⚠️ 미확정';
      lines.push(`> *${p.filePath}* (${mark}, score ${p.score})\n> ${p.rationale}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 3: formatter 테스트 → PASS**.

- [ ] **Step 4: task 실패 테스트**:

```ts
import { DocsSyncAuditTask } from './docs-sync-audit.autopilot-task';

function makeTask(over: any = {}) {
  const audit = { runAudit: jest.fn().mockResolvedValue(over.result) };
  const config = { get: jest.fn().mockReturnValue(over.enabled) };
  return { task: new DocsSyncAuditTask(audit as any, config as any), audit, config };
}

const ctx = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-29' };

it('이슈 0건이면 skip=true', async () => {
  const { task } = makeTask({ result: { deterministic: { inSync: true, details: [] }, proposals: [] } });
  expect(await task.run(ctx)).toEqual({ skip: true });
});

it('이슈 있으면 slackText 포함', async () => {
  const { task } = makeTask({
    result: { deterministic: { inSync: false, details: ['docs:check FAIL'] }, proposals: [] },
  });
  const result = await task.run(ctx);
  expect(result.skip).toBe(false);
  expect(result.slackText).toContain('docs:check');
});

it("DOCS_AUDIT_ENABLED='false' 면 runAudit 호출 안 하고 skip", async () => {
  const { task, audit } = makeTask({ enabled: 'false' });
  expect(await task.run(ctx)).toEqual({ skip: true });
  expect(audit.runAudit).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: task 구현**:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DOCS_AUDIT_PORT,
  DocsAuditPort,
} from '../../../docs-audit/domain/port/docs-audit.port';
import { formatDocsAudit } from '../../../slack/format/docs-audit.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 주간 문서↔코드 동기화 점검 — Layer1 결정론(docs:check/check:env) + Layer2 codex 자기수정 루프.
// 읽기 전용(파일 미수정)이라 T0_AUTO. DOCS_AUDIT_ENABLED='false' 면 전체 skip.
@Injectable()
export class DocsSyncAuditTask implements AutopilotTask {
  readonly id = 'docs-sync-audit';

  constructor(
    @Inject(DOCS_AUDIT_PORT) private readonly audit: DocsAuditPort,
    private readonly configService: ConfigService,
  ) {}

  async run({ firedAtKst }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (this.configService.get<string>('DOCS_AUDIT_ENABLED') === 'false') {
      return { skip: true };
    }
    const result = await this.audit.runAudit();
    const slackText = formatDocsAudit(result, firedAtKst);
    if (slackText.length === 0) {
      return { skip: true };
    }
    return { skip: false, slackText };
  }
}
```

- [ ] **Step 6: 테스트 → PASS**.

- [ ] **Step 7: Commit** (승인 시) — `git commit -m "feat(autopilot): docs-sync-audit task + formatter"`

---

## Task 9: 등록 + env + 통합 검증

**Files:**
- Modify: `src/autopilot/domain/autopilot.playbook-defaults.ts` (끝에 추가)
- Modify: `src/autopilot/domain/autopilot.playbook.ts` (배열 + import)
- Modify: `src/autopilot/autopilot.module.ts` (import + provider + factory)
- Modify: `src/config/app.config.ts`, `.env.example`, `.env`, `README.md`

- [ ] **Step 1: cron 기본값** — `autopilot.playbook-defaults.ts` 끝에:

```ts
// docs-sync-audit 기본 스케줄 — 매주 일 11:00 KST (knowledge-lint 일 10:00 과 1시간 분리).
export const DEFAULT_DOCS_AUDIT_CRON = '0 11 * * 0';
export const DEFAULT_DOCS_AUDIT_TIMEZONE = 'Asia/Seoul';
```

- [ ] **Step 2: 플레이북 등록** — `autopilot.playbook.ts` import에 `DEFAULT_DOCS_AUDIT_CRON, DEFAULT_DOCS_AUDIT_TIMEZONE` 추가, `AUTOPILOT_PLAYBOOK` 배열 끝(knowledge-lint 다음)에:

```ts
  // docs-sync-audit — 주간 문서↔코드 동기화 점검. 읽기 전용이라 T0_AUTO.
  {
    id: 'docs-sync-audit',
    taskId: 'docs-sync-audit',
    trigger: {
      kind: 'CRON',
      schedule: DEFAULT_DOCS_AUDIT_CRON,
      timezone: DEFAULT_DOCS_AUDIT_TIMEZONE,
    },
    riskTier: 'T0_AUTO',
  },
```

- [ ] **Step 3: 모듈 등록** — `autopilot.module.ts`:
  - import에 `import { DocsAuditModule } from '../docs-audit/docs-audit.module';` + `import { DocsSyncAuditTask } from './infrastructure/tasks/docs-sync-audit.autopilot-task';`
  - `imports` 배열에 `DocsAuditModule` 추가
  - `providers`에 `DocsSyncAuditTask` 추가
  - `AUTOPILOT_TASKS` useFactory의 인자/반환/inject 세 곳에 `docsSyncAudit: DocsSyncAuditTask` 추가 (knowledgeLint와 동일 패턴)

- [ ] **Step 4: env 4곳 동기** — `app.config.ts`의 `AUTOPILOT_KNOWLEDGE_LINT_L4_ENABLED` 다음에:

```ts
  // docs-sync-audit — 주간 문서↔코드 점검.
  // - DOCS_AUDIT_ENABLED: 'false' 면 task 전체 skip. 미설정 시 활성.
  // - DOCS_AUDIT_MAX_FILES: Layer2 가 점검할 최대 SoT 파일 수(codex 쿼터 가드, 기본 5).
  // - DOCS_AUDIT_MAX_ITERATIONS: Layer2 자기수정 반복 캡(기본 3).
  // - DOCS_AUDIT_SCHEDULE / _TIMEZONE: cron override (미설정 시 playbook-defaults).
  @IsOptional()
  @IsString()
  DOCS_AUDIT_ENABLED?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'DOCS_AUDIT_MAX_FILES 는 양의 정수여야 합니다.' })
  DOCS_AUDIT_MAX_FILES?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'DOCS_AUDIT_MAX_ITERATIONS 는 양의 정수여야 합니다.' })
  DOCS_AUDIT_MAX_ITERATIONS?: string;

  @IsOptional()
  @IsString()
  AUTOPILOT_DOCS_AUDIT_SCHEDULE?: string;

  @IsOptional()
  @IsString()
  AUTOPILOT_DOCS_AUDIT_TIMEZONE?: string;
```

  - `.env.example` + `.env`: 위 5개 키를 주석과 함께 추가(knowledge-lint 블록 옆).
  - `README.md`: env 표/autopilot task 목록에 docs-sync-audit 행 추가.

> **스케줄 override 연결**: autopilot scheduler가 `AUTOPILOT_<ID>_SCHEDULE`를 어떻게 읽는지 확인(app.config.ts:120-124 주석). 다른 항목과 동일 규칙으로 `DOCS_AUDIT` prefix가 자동 인식되는지 scheduler 코드를 보고, 안 되면 scheduler의 override 맵에 추가.

- [ ] **Step 5: 플레이북 spec 갱신** — `autopilot.playbook.spec.ts`에 항목 수/신규 id 검증이 있으면 docs-sync-audit 반영.

- [ ] **Step 6: 3중 green + docs:check**:

```bash
pnpm lint:check && pnpm test && pnpm build
pnpm docs:check
```

Expected: 모두 exit 0. `docs:check`가 FAIL이면(새 AgentType이 agent-catalog에 영향) → `pnpm docs:sync`로 카탈로그 재생성 후 그 변경분 포함 커밋. (CONTRADICTION_JUDGE처럼 AGENT_REGISTRY 미등록 내부 타입이면 영향 없음 — 확인만.)

- [ ] **Step 7: Commit** (승인 시) — `git commit -m "feat(autopilot): docs-sync-audit 플레이북 등록 + env 4곳 동기"`

---

## 검증 체크리스트 (완료 게이트)

- [ ] `pnpm lint:check` exit 0
- [ ] `pnpm test` exit 0 (신규 spec 5종 포함)
- [ ] `pnpm build` exit 0
- [ ] `pnpm docs:check` exit 0 (필요 시 `docs:sync` 반영)
- [ ] autopilot 부팅 시 `validatePlaybook` 통과(중복 id 없음)
- [ ] `DOCS_AUDIT_ENABLED=false`로 task skip 동작 수동 확인

## Phase 2 (이 plan 범위 밖)

`T1_PREVIEW` 경로: 확정 제안(`confirmed: true`)을 격리 worktree에 적용 → `docs:check` green → PreviewGate `create-preview` → Slack 승인 → `apply-preview`. autopilot orchestrator의 `T1_PREVIEW throw`([autopilot.orchestrator.ts:39-43](../../../src/autopilot/application/autopilot.orchestrator.ts#L39-L43)) 해제 + `AutopilotTaskResult`에 preview 페이로드 추가 필요. 별도 spec/plan.
