# 콘솔 리모컨 2A.1 — 실패 가시화 + PR 자동추론 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘솔 리모컨(Phase 2A, #160)의 두 UX blocker를 없앤다 — (A) dispatch 조기 실패가 앱에 이유와 함께 즉시 보이게 하고, (B) Code Reviewer·BE Fix에 PR을 안 적어도 콘솔 경로에서만 최근 open PR을 자동 선택해 진행하되 무엇을 골랐는지 투명하게 안내한다.

**Architecture:** 조기 실패(intent UNKNOWN·PR ref 파싱 실패·hint 누락 등)는 전부 `agentRunService.execute()` 전에 `throw`되어 `dispatch()` reject로 나오고, 콘솔 fire-and-forget 경로의 유일한 수신처가 `ConsoleWriteService.sendCommand`의 `.catch()`다. 이 단일 지점에서 새 SSE 이벤트 `command.rejected`를 발행한다. 자동추론은 **dispatcher 주도**로 하여 usecase를 완전 불변으로 둔다 — dispatcher가 `input.source === 'REMOTE_CONSOLE'`이고 입력이 유효 PR ref가 아닐 때만 최근 open PR을 조회해 `owner/repo#N`으로 확정한 뒤 usecase에 넘기고, 자동 선택 사실은 `autoResolvedNotice`로 반환해 콘솔이 `command.info`로 안내한다. 앱↔백엔드는 `commandId`(UUID)로 정확 매칭한다.

**Tech Stack:** NestJS 10 · TypeScript · RxJS Subject(ConsoleEventBus) · Swift(SwiftPM, CLT 실행형 러너)

## Global Constraints

- 패키지 매니저 `pnpm@9.15.9` — npm/yarn 금지. Node 22+, NestJS 10, Prisma 6.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- 신규 env 없음 — `IMPACT_REPORT_GITHUB_AUTHOR`(필수 트리거 조건) + `IMPACT_REPORT_GITHUB_REPO`(선택)를 재사용. docs:sync 불필요.
- **Slack 슬래시/멘션 경로 동작 불변** — 자동추론(B)은 `REMOTE_CONSOLE` source에서만 발동. usecase 시그니처·동작은 건드리지 않는다.
- 검증 3중 green: `pnpm lint:check && pnpm test && pnpm build`. Swift는 `swift build` + `swift run ConsoleCoreTests`.
- Swift는 백엔드 계약(`console.type.ts`)의 미러. 계약이 바뀌면 두 파일을 함께 갱신.
- 커밋은 사용자 명시 요청 후에만. 자발적 commit 금지.
- CODE_RULES: `catch (error)`(줄임말 금지), `if (...) { ... }`(단일라인 중괄호), 인라인 반환 타입 금지, magic number 상수화.

---

## File Structure

**PART A — 실패 가시화 (백엔드)**
- Modify `src/console/domain/console.type.ts` — ConsoleEvent union에 `command.rejected`·`command.info` 추가
- Modify `src/console/interface/dto/console-command.dto.ts` — `commandId?` 필드
- Modify `src/console/interface/console-write.controller.ts` — commandId 패스스루
- Modify `src/console/application/console-write.service.ts` — ConsoleEventBus 주입 + `.then`/`.catch` 발행

**PART B — 자동추론 (백엔드)**
- Modify `src/router/domain/port/agent-dispatcher.port.ts` — `DispatchOutcome.autoResolvedNotice?`
- Modify `src/router/domain/idaeri-router.port.ts` — `DispatchResult.autoResolvedNotice?`
- Modify `src/router/application/idaeri-router.usecase.ts` — currentResult에 autoResolvedNotice 전달
- Create `src/github/application/resolve-latest-open-pr.ts` — 최근 open PR 1건 → `{ prRef, notice }` 순수 헬퍼
- Create `src/agent/be-fix/domain/be-fix-pr-ref.parser.ts` — usecase 내 `parsePrRef` 추출(export)
- Modify `src/agent/be-fix/application/analyze-pr-convention.usecase.ts` — 추출한 파서 import(동작 불변)
- Modify `src/agent/code-reviewer/infrastructure/code-reviewer.dispatcher.ts` — ConfigService+GithubClient 주입, REMOTE_CONSOLE fallback
- Modify `src/agent/code-reviewer/domain/code-reviewer-error-code.enum.ts` + `code-reviewer.exception.ts` 사용처 — `NO_OPEN_PR_FOUND`
- Modify `src/agent/be-fix/infrastructure/be-fix.dispatcher.ts` — 동일 fallback
- Modify `src/agent/be-fix/domain/be-fix-error-code.enum.ts` — `NO_OPEN_PR_FOUND`
- Modify `src/agent/code-reviewer/code-reviewer.module.ts` + `src/agent/be-fix/be-fix.module.ts` — dispatcher가 ConfigService/GithubClient 받도록 provider 확인

**PART C — 앱 (Swift)**
- Modify `clients/idaeri-console/Sources/ConsoleCore/Models.swift` — ConsoleEvent 2 case, CommandRequest.commandId, PendingCommand.reason
- Modify `clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift` — commandId 매칭 적용
- Modify `clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift` — CommandRequest에 commandId
- Modify `clients/idaeri-console/Sources/IdaeriConsole/*` — pending에 reason 표시(뷰)
- Modify `clients/idaeri-console/Sources/ConsoleCoreTests/*` — 디코딩·적용 테스트

---

## PART A — 실패 가시화

### Task A1: ConsoleEvent union에 command 이벤트 2종 추가

**Files:**
- Modify: `src/console/domain/console.type.ts:60-71`

**Interfaces:**
- Produces: ConsoleEvent에 `{ type: 'command.rejected'; commandId: string; reason: string }` 와 `{ type: 'command.info'; commandId: string; message: string }` 두 variant.

- [ ] **Step 1:** `ConsoleEvent` union 끝에 두 variant 추가:

```ts
export type ConsoleEvent =
  | { readonly type: 'run.started' | 'run.finished'; readonly run: ConsoleRun }
  | {
      readonly type: 'approval.opened' | 'approval.resolved';
      readonly approval: ConsoleApproval;
    }
  | {
      readonly type: 'state.changed';
      readonly agentType: string;
      readonly state: ConsoleAgentState;
    }
  // 콘솔 지시(fire-and-forget)의 조기 실패 가시화 — dispatch reject 를 앱에 이유와 함께 전달.
  | {
      readonly type: 'command.rejected';
      readonly commandId: string;
      readonly reason: string;
    }
  // 지시가 자동 보정된 사실을 안내(예: PR 미지정 → 최근 open PR 자동 선택). 진행은 계속된다.
  | {
      readonly type: 'command.info';
      readonly commandId: string;
      readonly message: string;
    };
```

- [ ] **Step 2:** `pnpm build` — 타입 컴파일 확인.

### Task A2: ConsoleCommandDto에 commandId 추가 + 컨트롤러 패스스루

**Files:**
- Modify: `src/console/interface/dto/console-command.dto.ts`
- Modify: `src/console/interface/console-write.controller.ts:22-30`
- Test: `src/console/interface/console-write.controller.spec.ts`

**Interfaces:**
- Produces: `ConsoleCommandDto.commandId?: string`. 컨트롤러가 `consoleWrite.sendCommand({ text, agentTypeHint, commandId })` 호출.

- [ ] **Step 1: 실패 테스트** — controller.spec에 "commandId를 service로 전달한다" 케이스 추가:

```ts
it('commandId 를 service.sendCommand 로 전달한다', () => {
  const dto = { text: '최근 PR 리뷰', commandId: 'abc-123' } as ConsoleCommandDto;
  controller.sendCommand(dto);
  expect(sendCommand).toHaveBeenCalledWith({
    text: '최근 PR 리뷰',
    agentTypeHint: undefined,
    commandId: 'abc-123',
  });
});
```

- [ ] **Step 2:** DTO에 필드 추가:

```ts
export class ConsoleCommandDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  agentTypeHint?: string;

  // 앱이 생성한 UUID — command.rejected/command.info 이벤트를 이 지시에 정확 매칭하는 키.
  // 구버전 앱(미전송)과의 하위호환을 위해 선택.
  @IsOptional()
  @IsString()
  commandId?: string;
}
```

- [ ] **Step 3:** 컨트롤러가 commandId 전달:

```ts
@Post('command')
@HttpCode(202)
sendCommand(@Body() dto: ConsoleCommandDto): { accepted: true } {
  this.consoleWrite.sendCommand({
    text: dto.text,
    agentTypeHint: dto.agentTypeHint as AgentType | undefined,
    commandId: dto.commandId,
  });
  return { accepted: true };
}
```

- [ ] **Step 4:** `pnpm exec jest src/console/interface/console-write.controller.spec.ts` — PASS.

### Task A3: ConsoleWriteService가 실패/자동보정을 SSE로 발행

**Files:**
- Modify: `src/console/application/console-write.service.ts`
- Test: `src/console/application/console-write.service.spec.ts`

**Interfaces:**
- Consumes: `ConsoleEventBus.publish(event: ConsoleEvent)` (console-event-bus.service.ts), `DispatchResult.autoResolvedNotice?` (Task B2에서 추가 — 이 태스크 시점엔 옵셔널 접근이라 안전).
- Produces: `sendCommand(input: { text: string; agentTypeHint?: AgentType; commandId?: string }): void`.

- [ ] **Step 1: 실패 테스트** — service.spec에 3케이스 추가. router mock을 reject/resolve로 구성하고 bus.publish 호출을 검증:

```ts
it('dispatch reject 시 command.rejected 를 발행한다', async () => {
  router.dispatch.mockRejectedValue(new Error('PR 참조 형식이 잘못되었습니다'));
  service.sendCommand({ text: '리뷰', commandId: 'cid-1' });
  await flushPromises();
  expect(bus.publish).toHaveBeenCalledWith({
    type: 'command.rejected',
    commandId: 'cid-1',
    reason: 'PR 참조 형식이 잘못되었습니다',
  });
});

it('commandId 없으면 발행하지 않는다(구버전 앱 하위호환)', async () => {
  router.dispatch.mockRejectedValue(new Error('boom'));
  service.sendCommand({ text: '리뷰' });
  await flushPromises();
  expect(bus.publish).not.toHaveBeenCalled();
});

it('autoResolvedNotice 가 있으면 command.info 를 발행한다', async () => {
  router.dispatch.mockResolvedValue({
    agentRunId: 1, workerType: 'CODE_REVIEWER', output: {}, modelUsed: 'x',
    formattedText: '', autoResolvedNotice: 'PR 미지정 → 최근 open PR owner/repo#12 자동 선택',
  });
  service.sendCommand({ text: '리뷰', commandId: 'cid-2' });
  await flushPromises();
  expect(bus.publish).toHaveBeenCalledWith({
    type: 'command.info',
    commandId: 'cid-2',
    message: 'PR 미지정 → 최근 open PR owner/repo#12 자동 선택',
  });
});
```

`flushPromises`는 `() => new Promise((r) => setImmediate(r))`. spec 상단 mock에 `ConsoleEventBus`(publish jest.fn) 추가.

- [ ] **Step 2:** sendCommand 재작성. `.then`/`.catch` 양쪽에서 commandId가 있을 때만 발행:

```ts
constructor(
  private readonly config: ConfigService,
  @Inject(IDAERI_ROUTER_PORT)
  private readonly router: IdaeriRouterPort,
  private readonly applyPreview: ApplyPreviewUsecase,
  private readonly cancelPreview: CancelPreviewUsecase,
  private readonly eventBus: ConsoleEventBus,
) {}

sendCommand(input: {
  text: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}): void {
  const slackUserId = this.requireOwner();
  const commandId = input.commandId;
  void this.router
    .dispatch({
      source: 'REMOTE_CONSOLE',
      slackUserId,
      text: input.text,
      agentTypeHint: input.agentTypeHint,
    })
    .then((result) => {
      if (commandId && result.autoResolvedNotice) {
        this.eventBus.publish({
          type: 'command.info',
          commandId,
          message: result.autoResolvedNotice,
        });
      }
    })
    .catch((error: unknown) => {
      const reason =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`리모컨 지시 실패: ${reason}`);
      if (commandId) {
        this.eventBus.publish({
          type: 'command.rejected',
          commandId,
          reason,
        });
      }
    });
}
```

`ConsoleEventBus` import 추가(`../application/console-event-bus.service`). ConsoleModule providers에 이미 ConsoleEventBus 있는지 확인(ConsoleEventBusModule @Global 이라 주입 가능) — 없으면 import.

- [ ] **Step 3:** `pnpm exec jest src/console/application/console-write.service.spec.ts` — PASS.

---

## PART B — 자동추론 (dispatcher 주도, 콘솔 국한)

### Task B1: DispatchOutcome / DispatchResult에 autoResolvedNotice 추가

**Files:**
- Modify: `src/router/domain/port/agent-dispatcher.port.ts` (DispatchOutcome)
- Modify: `src/router/domain/idaeri-router.port.ts` (DispatchResult)
- Modify: `src/router/application/idaeri-router.usecase.ts:133-140` (currentResult)

**Interfaces:**
- Produces: `DispatchOutcome.autoResolvedNotice?: string`, `DispatchResult.autoResolvedNotice?: string`.

- [ ] **Step 1:** DispatchOutcome에 필드 추가(주석 포함):

```ts
export interface DispatchOutcome {
  agentRunId: number;
  output: unknown;
  modelUsed: string;
  formattedText: string;
  followUp?: HandoffSpec;
  // 콘솔 자동추론 안내 — dispatcher 가 PR 미지정을 최근 open PR 로 보정했을 때 그 사실.
  // 콘솔 경로만 채움. 콘솔이 command.info 로 앱에 안내한다.
  autoResolvedNotice?: string;
}
```

- [ ] **Step 2:** DispatchResult에 동일 필드 추가.

- [ ] **Step 3:** idaeri-router.usecase.ts `currentResult` 구성에 전달:

```ts
const currentResult: DispatchResult = {
  agentRunId: outcome.agentRunId,
  workerType: agentType,
  output: outcome.output,
  modelUsed: outcome.modelUsed,
  formattedText: outcome.formattedText,
  followUp: outcome.followUp,
  ...(outcome.autoResolvedNotice !== undefined
    ? { autoResolvedNotice: outcome.autoResolvedNotice }
    : {}),
};
```

- [ ] **Step 4:** `pnpm build` — 컴파일 확인.

### Task B2: 최근 open PR resolver 순수 헬퍼

**Files:**
- Create: `src/github/application/resolve-latest-open-pr.ts`
- Test: `src/github/application/resolve-latest-open-pr.spec.ts`

**Interfaces:**
- Consumes: `GithubClientPort.listAuthorOpenPullRequests({ repo, author, sinceIsoDate, limit })` → `GithubPullRequestSummary[]` (updatedAt DESC).
- Produces: `resolveLatestOpenPrRef(githubClient, input: { author: string; repo: string | null; sinceIsoDate: string }): Promise<{ prRef: string; notice: string } | null>`.

- [ ] **Step 1: 실패 테스트:**

```ts
describe('resolveLatestOpenPrRef', () => {
  const base = { author: 'JSL107', repo: 'JSL107/personal_agents', sinceIsoDate: '2026-01-01' };

  it('최근 open PR 을 prRef + notice 로 반환한다', async () => {
    const githubClient = {
      listAuthorOpenPullRequests: jest.fn().mockResolvedValue([
        { repo: 'JSL107/personal_agents', number: 42, title: '콘솔 리모컨', state: 'open',
          url: 'u', body: '', mergedAt: null, updatedAt: '2026-07-27', additions: 1, deletions: 0, changedFilesCount: 1 },
      ]),
    } as unknown as GithubClientPort;
    const result = await resolveLatestOpenPrRef(githubClient, base);
    expect(result).toEqual({
      prRef: 'JSL107/personal_agents#42',
      notice: expect.stringContaining('JSL107/personal_agents#42'),
    });
    expect(githubClient.listAuthorOpenPullRequests).toHaveBeenCalledWith({
      repo: 'JSL107/personal_agents', author: 'JSL107', sinceIsoDate: '2026-01-01', limit: 1,
    });
  });

  it('open PR 이 없으면 null', async () => {
    const githubClient = {
      listAuthorOpenPullRequests: jest.fn().mockResolvedValue([]),
    } as unknown as GithubClientPort;
    expect(await resolveLatestOpenPrRef(githubClient, base)).toBeNull();
  });
});
```

- [ ] **Step 2: 구현:**

```ts
import {
  GithubClientPort,
} from '../domain/port/github-client.port';

export interface ResolveLatestOpenPrInput {
  author: string;
  repo: string | null;
  sinceIsoDate: string;
}

export interface ResolvedLatestOpenPr {
  prRef: string; // "owner/repo#number"
  notice: string;
}

// PR 미지정 콘솔 지시를 위해 author 의 최근 open PR 1건을 owner/repo#N 으로 확정한다.
// listAuthorOpenPullRequests 는 updatedAt DESC 정렬이라 [0] 이 가장 최근. 없으면 null.
export const resolveLatestOpenPrRef = async (
  githubClient: GithubClientPort,
  { author, repo, sinceIsoDate }: ResolveLatestOpenPrInput,
): Promise<ResolvedLatestOpenPr | null> => {
  const opens = await githubClient.listAuthorOpenPullRequests({
    repo,
    author,
    sinceIsoDate,
    limit: 1,
  });
  const latest = opens[0];
  if (!latest) {
    return null;
  }
  const prRef = `${latest.repo}#${latest.number}`;
  return {
    prRef,
    notice: `PR 미지정 → 최근 open PR ${prRef} 자동 선택: ${latest.title}`,
  };
};
```

- [ ] **Step 3:** `pnpm exec jest src/github/application/resolve-latest-open-pr.spec.ts` — PASS.

### Task B3: be-fix PR ref 파서 추출(export)

**Files:**
- Create: `src/agent/be-fix/domain/be-fix-pr-ref.parser.ts`
- Modify: `src/agent/be-fix/application/analyze-pr-convention.usecase.ts:33-36,157-176` (import로 교체)
- Test: `src/agent/be-fix/domain/be-fix-pr-ref.parser.spec.ts`

**Interfaces:**
- Produces: `parseBeFixPrRef(raw: string): PullRequestRef | null` — usecase의 기존 `parsePrRef`와 동일 로직(URL/shorthand/number-only). `isValidBeFixPrRef(raw: string): boolean`.

- [ ] **Step 1: 실패 테스트** — 기존 usecase 동작과 동일함을 고정:

```ts
it('shorthand/URL/number 를 파싱하고, 자연어는 null', () => {
  expect(parseBeFixPrRef('owner/repo#3')).toEqual({ repo: 'owner/repo', number: 3 });
  expect(parseBeFixPrRef('123')).toEqual({ repo: '', number: 123 });
  expect(parseBeFixPrRef('최근 PR 봐줘')).toBeNull();
});
it('isValidBeFixPrRef 는 파싱 성공 여부', () => {
  expect(isValidBeFixPrRef('owner/repo#3')).toBe(true);
  expect(isValidBeFixPrRef('')).toBe(false);
  expect(isValidBeFixPrRef('그냥 텍스트')).toBe(false);
});
```

- [ ] **Step 2:** usecase의 `URL_PATTERN`/`SHORTHAND_PATTERN`/`NUMBER_PATTERN` + `parsePrRef`를 새 파일로 이동, `parseBeFixPrRef`로 export + `isValidBeFixPrRef` 추가. usecase는 `import { parseBeFixPrRef } from '../domain/be-fix-pr-ref.parser'` 후 `parsePrRef(trimmed)` → `parseBeFixPrRef(trimmed)`로 교체(로컬 const/정규식 3개 삭제).

- [ ] **Step 3:** `pnpm exec jest src/agent/be-fix` — 파서 spec + 기존 usecase spec PASS(동작 불변 확인).

### Task B4: 에러코드 NO_OPEN_PR_FOUND 추가

**Files:**
- Modify: `src/agent/code-reviewer/domain/code-reviewer-error-code.enum.ts`
- Modify: `src/agent/be-fix/domain/be-fix-error-code.enum.ts`

- [ ] **Step 1:** 각 enum에 `NO_OPEN_PR_FOUND = 'NO_OPEN_PR_FOUND'` 추가. (ResponseCode/에러코드 참조표가 있으면 함께 갱신 — AGENTS.md 체크리스트 확인, 없으면 enum만.)

- [ ] **Step 2:** `pnpm build`.

### Task B5: CodeReviewerDispatcher 자동추론 (REMOTE_CONSOLE 국한)

**Files:**
- Modify: `src/agent/code-reviewer/infrastructure/code-reviewer.dispatcher.ts`
- Modify: `src/agent/code-reviewer/code-reviewer.module.ts` (GithubClient/ConfigService 주입 가능 확인)
- Test: `src/agent/code-reviewer/infrastructure/code-reviewer.dispatcher.spec.ts` (없으면 생성)

**Interfaces:**
- Consumes: `resolveLatestOpenPrRef` (B2), `parsePrReference`(code-reviewer 기존 export — try/catch로 유효성 판정), `ConfigService`, `GITHUB_CLIENT_PORT`, `CodeReviewerException` + `NO_OPEN_PR_FOUND`.
- Produces: `DispatchOutcome.autoResolvedNotice` 채움.

- [ ] **Step 1: 실패 테스트** — 3케이스:
  - `source !== 'REMOTE_CONSOLE'`이고 자연어면 자동추론 안 함(usecase 그대로 호출, notice 없음).
  - `REMOTE_CONSOLE` + 유효 PR ref면 자동추론 안 함(원본 prRef 그대로).
  - `REMOTE_CONSOLE` + 자연어 + author env 있음 + open PR 존재 → prRef 보정 + `autoResolvedNotice` 채움.
  - `REMOTE_CONSOLE` + 자연어 + author env 있음 + open PR 0건 → `CodeReviewerException(NO_OPEN_PR_FOUND)` throw.

```ts
it('REMOTE_CONSOLE + 자연어 + open PR 있으면 최근 PR 로 보정하고 notice 를 채운다', async () => {
  config.get.mockReturnValue('JSL107'); // AUTHOR (REPO는 두 번째 get)
  githubClient.listAuthorOpenPullRequests.mockResolvedValue([
    { repo: 'JSL107/personal_agents', number: 42, title: 't', state: 'open', url: 'u',
      body: '', mergedAt: null, updatedAt: '2026-07-27', additions: 1, deletions: 0, changedFilesCount: 1 },
  ]);
  reviewPullRequest.execute.mockResolvedValue({ agentRunId: 1, result: {}, modelUsed: 'm' });
  const outcome = await dispatcher.dispatch({ source: 'REMOTE_CONSOLE', slackUserId: 'U', text: '최근 PR 리뷰' });
  expect(reviewPullRequest.execute).toHaveBeenCalledWith(
    expect.objectContaining({ prRef: 'JSL107/personal_agents#42' }));
  expect(outcome.autoResolvedNotice).toContain('JSL107/personal_agents#42');
});
```

- [ ] **Step 2: 구현:**

```ts
import { ConfigService } from '@nestjs/config';
import { Inject, Injectable } from '@nestjs/common';
import { GITHUB_CLIENT_PORT, GithubClientPort } from '../../../github/domain/port/github-client.port';
import { resolveLatestOpenPrRef } from '../../../github/application/resolve-latest-open-pr';
import { parsePrReference } from '../domain/pr-reference.parser';
import { CodeReviewerException } from '../domain/code-reviewer.exception';
import { CodeReviewerErrorCode } from '../domain/code-reviewer-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';

// 자동추론 open PR 조회 범위 — 콘솔에서 "PR 안 적음" 시 최근 열려있는 PR 을 넓게 잡는다.
const AUTO_RESOLVE_LOOKBACK_DAYS = 180;

@Injectable()
export class CodeReviewerDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CODE_REVIEWER;

  constructor(
    private readonly reviewPullRequest: ReviewPullRequestUsecase,
    private readonly config: ConfigService,
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    let prRef = input.text ?? '';
    let autoResolvedNotice: string | undefined;

    if (input.source === 'REMOTE_CONSOLE' && !isValidPrRef(prRef)) {
      const resolved = await this.resolveLatestOrThrow();
      if (resolved) {
        prRef = resolved.prRef;
        autoResolvedNotice = resolved.notice;
      }
      // author env 미설정이면 resolved=null → 보정 없이 진행, usecase 가 INVALID_PR_REFERENCE
      // throw → 콘솔 catch 가 command.rejected 로 안내(기존 Slack 동작과 동일한 이유 문구).
    }

    const outcome = await this.reviewPullRequest.execute({
      prRef,
      slackUserId: input.slackUserId,
      ...(input.conversationContext !== undefined
        ? { conversationContext: input.conversationContext }
        : {}),
    });
    return {
      agentRunId: outcome.agentRunId,
      output: outcome.result,
      modelUsed: outcome.modelUsed,
      formattedText: formatPullRequestReview({ prRef, review: outcome.result }),
      ...(autoResolvedNotice !== undefined ? { autoResolvedNotice } : {}),
    };
  }

  private async resolveLatestOrThrow(): Promise<{ prRef: string; notice: string } | null> {
    const author = this.config.get<string>('IMPACT_REPORT_GITHUB_AUTHOR');
    if (!author) {
      return null;
    }
    const repoEnv = this.config.get<string>('IMPACT_REPORT_GITHUB_REPO');
    const repo = repoEnv && repoEnv.trim().length > 0 ? repoEnv : null;
    const sinceIsoDate = new Date(
      Date.now() - AUTO_RESOLVE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const resolved = await resolveLatestOpenPrRef(this.githubClient, {
      author,
      repo,
      sinceIsoDate,
    });
    if (!resolved) {
      throw new CodeReviewerException({
        code: CodeReviewerErrorCode.NO_OPEN_PR_FOUND,
        message: `리뷰할 PR 을 지정하지 않았고, 최근 ${AUTO_RESOLVE_LOOKBACK_DAYS}일 안에 열려있는 PR 도 없습니다. PR 링크(owner/repo#N)를 함께 지시해주세요.`,
        status: DomainStatus.NOT_FOUND,
      });
    }
    return resolved;
  }
}

const isValidPrRef = (raw: string): boolean => {
  try {
    parsePrReference(raw);
    return true;
  } catch {
    return false;
  }
};
```

- [ ] **Step 3:** module의 providers/imports에 ConfigModule(전역이면 불필요)·GITHUB_CLIENT_PORT가 dispatcher 주입 범위에 있는지 확인. usecase가 이미 GITHUB_CLIENT_PORT를 받으므로 모듈에 provider 존재 — dispatcher 주입 OK.

- [ ] **Step 4:** `pnpm exec jest src/agent/code-reviewer` — PASS.

### Task B6: BeFixDispatcher 자동추론 (동일 패턴)

**Files:**
- Modify: `src/agent/be-fix/infrastructure/be-fix.dispatcher.ts`
- Modify: `src/agent/be-fix/be-fix.module.ts`
- Test: `src/agent/be-fix/infrastructure/be-fix.dispatcher.spec.ts` (없으면 생성)

**Interfaces:**
- Consumes: `isValidBeFixPrRef`(B3), `resolveLatestOpenPrRef`(B2), `ConfigService`, `GITHUB_CLIENT_PORT`, `BeFixException` + `NO_OPEN_PR_FOUND`.

- [ ] **Step 1: 실패 테스트** — B5와 동일 4케이스(BE_FIX 버전).

- [ ] **Step 2:** B5와 동일 구조. 차이: 유효성 판정 `isValidBeFixPrRef(prRef)`, usecase 호출은 `analyzePrConvention.execute({ prRef, slackUserId })`, 예외는 `BeFixException` + `BeFixErrorCode.NO_OPEN_PR_FOUND`, `AUTO_RESOLVE_LOOKBACK_DAYS` 상수 재사용(공용 상수 파일로 뽑거나 각 dispatcher에 동일 값). formattedText는 `formatPrConventionReport(outcome.result)`.

- [ ] **Step 3:** `pnpm exec jest src/agent/be-fix` — PASS.

---

## PART C — 앱 (Swift)

### Task C1: Models.swift — 이벤트 2 case + commandId + reason

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/Models.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/ModelsTests.swift`, `SSEParserTests.swift`

**Interfaces:**
- Produces: `ConsoleEvent.commandRejected(commandId:reason:)`, `.commandInfo(commandId:message:)`; `CommandRequest.commandId: String`; `PendingCommand.reason: String?`.

- [ ] **Step 1: 실패 테스트** — ModelsTests에 디코딩 케이스:

```swift
func testDecodeCommandRejected() throws {
    let json = #"{"type":"command.rejected","commandId":"c1","reason":"PR 참조 형식이 잘못되었습니다"}"#
    let event = try JSONDecoder().decode(ConsoleEvent.self, from: Data(json.utf8))
    guard case let .commandRejected(commandId, reason) = event else { return expectFail("...") }
    expectEqual(commandId, "c1")
    expectEqual(reason, "PR 참조 형식이 잘못되었습니다")
}
func testDecodeCommandInfo() throws { /* type=command.info, message 필드 */ }
```

- [ ] **Step 2:** ConsoleEvent enum에 case + CodingKeys(`commandId`, `reason`, `message`) + switch 분기 추가:

```swift
case commandRejected(commandId: String, reason: String)
case commandInfo(commandId: String, message: String)
// CodingKeys 에 case commandId, reason, message 추가
// init(from:) switch 에:
case "command.rejected":
    self = .commandRejected(
        commandId: try container.decode(String.self, forKey: .commandId),
        reason: try container.decode(String.self, forKey: .reason))
case "command.info":
    self = .commandInfo(
        commandId: try container.decode(String.self, forKey: .commandId),
        message: try container.decode(String.self, forKey: .message))
```

- [ ] **Step 3:** `CommandRequest`에 `commandId: String` 추가(init 포함). `PendingCommand`에 `var reason: String?` 추가(init default nil).

- [ ] **Step 4:** `swift run ConsoleCoreTests` — PASS.

### Task C2: ConsoleStore — commandId 정확 매칭

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/ConsoleStore.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleStoreTests.swift`

**Interfaces:**
- Consumes: `ConsoleEvent.commandRejected/commandInfo`, `PendingCommand.reason`.

- [ ] **Step 1: 실패 테스트:**

```swift
func testCommandRejectedMarksFailedWithReason() {
    let store = ConsoleStore()
    let id = store.enqueueCommand(text: "리뷰", agentTypeHint: nil)
    store.apply(event: .commandRejected(commandId: id.uuidString, reason: "PR 없음"))
    let pending = store.pendingCommands.first { $0.id == id }!
    expectEqual(pending.phase, .failed)
    expectEqual(pending.reason, "PR 없음")
}
func testCommandInfoSetsReasonKeepsPhase() {
    // enqueue → .commandInfo → reason 세팅, phase 는 .sent 유지
}
func testCommandRejectedUnknownIdNoOp() { /* 모르는 commandId 는 무시 */ }
```

- [ ] **Step 2:** `apply(event:)` switch에 두 case 추가:

```swift
case let .commandRejected(commandId, reason):
    markCommand(commandId: commandId, phase: .failed, reason: reason)
case let .commandInfo(commandId, message):
    annotateCommand(commandId: commandId, reason: message)
```

+ 헬퍼:

```swift
private func markCommand(commandId: String, phase: PendingPhase, reason: String?) {
    guard let uuid = UUID(uuidString: commandId),
          let index = pendingCommands.firstIndex(where: { $0.id == uuid }) else { return }
    pendingCommands[index].phase = phase
    pendingCommands[index].reason = reason
}
private func annotateCommand(commandId: String, reason: String) {
    guard let uuid = UUID(uuidString: commandId),
          let index = pendingCommands.firstIndex(where: { $0.id == uuid }) else { return }
    pendingCommands[index].reason = reason
}
```

- [ ] **Step 3:** `swift run ConsoleCoreTests` — PASS.

### Task C3: ConsoleClient — CommandRequest에 commandId 실어 전송

**Files:**
- Modify: `clients/idaeri-console/Sources/ConsoleCore/ConsoleClient.swift`
- Test: `clients/idaeri-console/Sources/ConsoleCoreTests/ConsoleClientTests.swift`

- [ ] **Step 1:** ConsoleClient.swift에서 `sendCommand`가 CommandRequest를 만들 때 `commandId`를 받는 파라미터 추가(호출자=뷰가 store.enqueueCommand 반환 UUID.uuidString 전달). body 인코딩에 commandId 포함. 기존 테스트가 body를 검증하면 commandId 반영.

- [ ] **Step 2:** `swift run ConsoleCoreTests` — PASS. (ConsoleClient가 실제 네트워크면 인코딩 단위만 테스트.)

### Task C4: 뷰 — pending에 reason 표시

**Files:**
- Modify: `clients/idaeri-console/Sources/IdaeriConsole/DashboardView.swift` 또는 커맨드바/pending 표시 뷰
- Modify: 지시 전송 지점 — `store.enqueueCommand` 반환 UUID를 `client.sendCommand(..., commandId:)`로 전달하도록 배선

- [ ] **Step 1:** pending 목록 렌더에서 `.failed`면 reason을 빨강, `.commandInfo`로 채워진 reason(진행 중)은 회색 보조문구로 표시. GUI라 실행형 러너 없음 — `swift build`로 컴파일만 보장.

- [ ] **Step 2:** 지시 전송 흐름: `let id = store.enqueueCommand(text:agentTypeHint:)` → `client.sendCommand(text:agentTypeHint:commandId: id.uuidString)`. 실패 시 기존 `markCommandFailed(id:)` 유지(네트워크 실패 폴백).

- [ ] **Step 3:** `swift build` — 링크/컴파일 green.

---

## Self-Review

**Spec coverage:**
- A(실패 가시화): A1(이벤트)·A2(commandId 계약)·A3(발행) + C1·C2(앱 수신). ✅
- B(자동추론 콘솔 국한): B1(계약)·B2(resolver)·B3(파서)·B4(에러코드)·B5·B6(dispatcher) + A3(command.info 발행) + C1·C2(앱 안내). Slack 불변 = usecase 무수정으로 보장. ✅
- 자동 선택 투명성: autoResolvedNotice → command.info → 앱 reason 표시. ✅

**Type consistency:** `autoResolvedNotice`(DispatchOutcome/DispatchResult 동일명), `command.rejected`/`command.info`(백엔드 union ↔ Swift case rawValue 문자열 동일), `commandId`(DTO/CommandRequest/이벤트 전부 동일), `resolveLatestOpenPrRef`(B2 정의 = B5·B6 사용), `parseBeFixPrRef`/`isValidBeFixPrRef`(B3 정의 = B6 사용). ✅

**리스크:** (1) B가 "엉뚱한 PR" 선택 → command.info로 무엇을 골랐는지 항상 노출(투명성)로 완화. (2) DispatchOutcome/Result 계약 확장은 옵셔널이라 기존 dispatcher/handler 무영향. (3) commandId 미전송(구버전 앱) → 발행 skip, 기존 60s 타임아웃 폴백 유지.
