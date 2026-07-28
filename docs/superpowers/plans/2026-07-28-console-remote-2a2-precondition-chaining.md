# 콘솔 리모컨 2A.2 — 상태 precondition 자동 체이닝 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 콘솔 리모컨에서 상태 precondition worker(CTO/PO_SHADOW/CEO/PO_EVAL)를 선행 run 없이 호출해도, 선행 worker를 자동으로 먼저 트리거해 최종 worker까지 진행되게 한다.

**Architecture:** 콘솔 write 경로의 단일 `router.dispatch` 호출을 신규 `PreconditionChainOrchestrator`로 감싼다. usecase가 LLM 호출 *전에* 던지는 precondition 도메인 예외를 잡아, `errorCode → 선행 worker` 정적 매핑으로 선행을 먼저 실행(재귀)하고 원래 worker를 재시도한다. REMOTE_CONSOLE 국한 — 라우터·usecase·Slack 경로 불변.

**Tech Stack:** NestJS 10, TypeScript, RxJS(ConsoleEventBus), Jest. 패키지 매니저 pnpm.

## Global Constraints

- 패키지 매니저는 **pnpm** 전용 (`npm`/`yarn` 금지).
- 검증 3종 전부 green이어야 완료: `pnpm lint:check`, `pnpm build`, 그리고 단일 파일 테스트는 `pnpm exec jest <경로>` (이 레포의 `pnpm test`는 jest 2단계 실행이라 경로 필터가 안 먹음).
- 모든 신규 코드 블록은 prettier-clean(2-space indent, single quote, trailing comma, semicolon) — implementer는 커밋 전 반드시 `pnpm lint:check` 통과 확인.
- `process.env` 직접 참조 금지 → `ConfigService.get(...)`.
- 자동 체이닝은 `source: 'REMOTE_CONSOLE'` 경로에서만 발동. 라우터·usecase·dispatcher·Slack 경로는 한 줄도 수정하지 않는다.
- 새 env `CONSOLE_CHAIN_IMPACT_RECENT_DAYS` 추가 시 4곳 동기: `.env.example` + `.env` + `src/config/app.config.ts`(class-validator) + `README`.
- 커밋은 각 Task 끝에서 의미 단위로. 형식 `<type>(<scope>): <subject>`, 한국어 OK, 말미에 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `MAX_CHAIN_DEPTH = 3` (기존 `MAX_HANDOFF_DEPTH`와 일관).

## Task별 TDD 적용 여부

| Task | TDD | 사유 |
|---|---|---|
| 1 매핑 테이블 | 경량(정합성 테스트) | 순수 상수+타입. 로직 없음 — 매핑 완전성/kind만 assert |
| 2 오케스트레이터 | 예(완전 TDD) | 재시도·가드·재귀 로직 — 테스트 먼저 |
| 3 service 위임 전환 | 예(기존 spec 갱신) | 기존 spec이 dispatch 직접 호출 검증 → orchestrator 위임으로 갱신 |
| 4 module 등록 + env 동기 | 아니오 | DI 배선·env 선언. build로 검증 |

---

## Task 1: 예외 → 선행 매핑 테이블

**Files:**
- Create: `src/console/domain/precondition-chain.map.ts`
- Test: `src/console/domain/precondition-chain.map.spec.ts`

**Interfaces:**
- Consumes: `AgentType`(`src/model-router/domain/model-router.type`), 각 worker의 ErrorCode enum.
- Produces:
  - `type ChainResolution = { kind: 'PREREQ'; failedWorkerLabel: string; prereqWorker: AgentType; needsRecentArg?: boolean } | { kind: 'UNRESOLVABLE' }`
  - `const PRECONDITION_CHAIN_MAP: Readonly<Record<string, ChainResolution>>`
  - `function resolveChain(errorCode: string): ChainResolution | undefined`

- [ ] **Step 1: 매핑 테이블 파일 작성**

매핑 키는 각 enum의 실제 value 문자열이며 6개 모두 고유하다(`PARSE_FAILED`는 3곳 중복이나 매핑 대상 아님). enum을 import해 키로 쓴다.

```ts
import { AgentType } from '../../model-router/domain/model-router.type';
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { PoShadowErrorCode } from '../../agent/po-shadow/domain/po-shadow-error-code.enum';

// 콘솔 리모컨 2A.2 — precondition 예외를 "먼저 당길 선행 worker"로 매핑한다.
// errorCode 하나가 실패 worker + 없는 선행 + (필요 시)합성 인자를 함의한다.
// PREREQ: 선행 worker를 먼저 실행하면 원래 worker가 진행 가능.
// UNRESOLVABLE: 선행은 있으나 조건 미충족(비결정적) — 자동해소 불가, 즉시 안내.
export type ChainResolution =
  | {
      readonly kind: 'PREREQ';
      readonly failedWorkerLabel: string;
      readonly prereqWorker: AgentType;
      readonly needsRecentArg?: boolean;
    }
  | { readonly kind: 'UNRESOLVABLE' };

export const PRECONDITION_CHAIN_MAP: Readonly<Record<string, ChainResolution>> =
  {
    [CtoErrorCode.NO_RECENT_PM_RUN]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'CTO',
      prereqWorker: AgentType.PM,
    },
    [CtoErrorCode.STALE_PM_RUN]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'CTO',
      prereqWorker: AgentType.PM,
    },
    [PoShadowErrorCode.NO_RECENT_PLAN]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'PO_SHADOW',
      prereqWorker: AgentType.PM,
    },
    [CeoErrorCode.NO_PO_EVAL_RUN]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'CEO',
      prereqWorker: AgentType.PO_EVAL,
    },
    [PoEvalErrorCode.NO_SUB_AGENT_RUNS]: {
      kind: 'PREREQ',
      failedWorkerLabel: 'PO_EVAL',
      prereqWorker: AgentType.IMPACT_REPORTER,
      needsRecentArg: true,
    },
    [CtoErrorCode.NO_ASSIGNABLE_TASKS]: { kind: 'UNRESOLVABLE' },
  };

export function resolveChain(errorCode: string): ChainResolution | undefined {
  return PRECONDITION_CHAIN_MAP[errorCode];
}
```

- [ ] **Step 2: 정합성 테스트 작성**

```ts
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { PoShadowErrorCode } from '../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { resolveChain } from './precondition-chain.map';

describe('precondition-chain.map', () => {
  it('CTO PM 부재는 PM 선행으로 해소한다', () => {
    expect(resolveChain(CtoErrorCode.NO_RECENT_PM_RUN)).toEqual({
      kind: 'PREREQ',
      failedWorkerLabel: 'CTO',
      prereqWorker: AgentType.PM,
    });
    expect(resolveChain(CtoErrorCode.STALE_PM_RUN)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.PM,
    });
  });

  it('PO_SHADOW plan 부재는 PM 선행으로 해소한다', () => {
    expect(resolveChain(PoShadowErrorCode.NO_RECENT_PLAN)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.PM,
    });
  });

  it('CEO PO_EVAL 부재는 PO_EVAL 선행으로 해소한다', () => {
    expect(resolveChain(CeoErrorCode.NO_PO_EVAL_RUN)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.PO_EVAL,
    });
  });

  it('PO_EVAL sub-agent 부재는 IMPACT_REPORTER --recent 로 해소한다', () => {
    expect(resolveChain(PoEvalErrorCode.NO_SUB_AGENT_RUNS)).toMatchObject({
      kind: 'PREREQ',
      prereqWorker: AgentType.IMPACT_REPORTER,
      needsRecentArg: true,
    });
  });

  it('CTO assignableTaskIds 부재는 자동해소 불가로 분류한다', () => {
    expect(resolveChain(CtoErrorCode.NO_ASSIGNABLE_TASKS)).toEqual({
      kind: 'UNRESOLVABLE',
    });
  });

  it('매핑에 없는 errorCode 는 undefined', () => {
    expect(resolveChain('PARSE_FAILED')).toBeUndefined();
    expect(resolveChain('IMPACT_REPORTER_RECENT_MODE_ENV_MISSING')).toBeUndefined();
  });
});
```

- [ ] **Step 3: 테스트 실행 → PASS 확인**

Run: `pnpm exec jest src/console/domain/precondition-chain.map.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 4: lint 확인**

Run: `pnpm lint:check`
Expected: 0 errors

- [ ] **Step 5: 커밋**

```bash
git add src/console/domain/precondition-chain.map.ts src/console/domain/precondition-chain.map.spec.ts
git commit -m "feat(console): 2A.2 precondition 예외→선행 매핑 테이블

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: PreconditionChainOrchestrator (재시도 루프)

**Files:**
- Create: `src/console/application/precondition-chain.orchestrator.ts`
- Test: `src/console/application/precondition-chain.orchestrator.spec.ts`

**Interfaces:**
- Consumes:
  - `IDAERI_ROUTER_PORT` / `IdaeriRouterPort`(`src/router/domain/idaeri-router.port`) — `dispatch(input): Promise<DispatchResult>`
  - `ConsoleEventBus`(`./console-event-bus.service`) — `publish(event: ConsoleEvent): void`
  - `ConfigService` — `CONSOLE_CHAIN_IMPACT_RECENT_DAYS`
  - `resolveChain`, `ChainResolution`(Task 1)
  - `DomainException`(`src/common/exception/domain.exception`) — `errorCode: string`
  - `AgentType`(`src/model-router/domain/model-router.type`)
- Produces:
  - `interface ConsoleChainInput { slackUserId: string; text?: string; agentTypeHint?: AgentType; commandId?: string }`
  - `class PreconditionChainOrchestrator` with `async run(input: ConsoleChainInput): Promise<void>`

- [ ] **Step 1: 실패 테스트 작성 (핵심 시나리오)**

mock 패턴은 기존 `console-write.service.spec.ts`를 따른다(plain object mock + `flush()`).

```ts
import { ConfigService } from '@nestjs/config';

import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { ConsoleEventBus } from './console-event-bus.service';
import { PreconditionChainOrchestrator } from './precondition-chain.orchestrator';

class FakeDomainException extends DomainException {
  readonly errorCode: string;
  readonly status = DomainStatus.NOT_FOUND;
  constructor(code: string) {
    super(`도메인 오류: ${code}`);
    this.errorCode = code;
  }
}

function make(recentDays?: string) {
  const config = {
    get: (key: string) =>
      key === 'CONSOLE_CHAIN_IMPACT_RECENT_DAYS' ? recentDays : undefined,
  } as unknown as ConfigService;
  const router = { dispatch: jest.fn() };
  const consoleEvents = { publish: jest.fn() };
  const orchestrator = new PreconditionChainOrchestrator(
    router as never,
    consoleEvents as unknown as ConsoleEventBus,
    config,
  );
  return { orchestrator, router, consoleEvents };
}

function ok(workerType: string) {
  return {
    agentRunId: 1,
    workerType,
    output: {},
    modelUsed: 'codex',
    formattedText: '완료',
  };
}

describe('PreconditionChainOrchestrator', () => {
  it('선행이 이미 있으면 체이닝 없이 단일 dispatch 로 성공한다', async () => {
    const { orchestrator, router } = make();
    router.dispatch.mockResolvedValue(ok('CEO'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CEO' as never,
      commandId: 'c1',
    });

    expect(router.dispatch).toHaveBeenCalledTimes(1);
  });

  it('CEO 풀체인: PO_EVAL·IMPACT 선행을 당겨 3-hop 으로 성공한다', async () => {
    const { orchestrator, router, consoleEvents } = make('7');
    // 호출 순서: CEO(실패) → PO_EVAL(실패) → IMPACT(성공) → PO_EVAL(성공) → CEO(성공)
    router.dispatch
      .mockRejectedValueOnce(new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN))
      .mockRejectedValueOnce(
        new FakeDomainException(PoEvalErrorCode.NO_SUB_AGENT_RUNS),
      )
      .mockResolvedValueOnce(ok('IMPACT_REPORTER'))
      .mockResolvedValueOnce(ok('PO_EVAL'))
      .mockResolvedValueOnce(ok('CEO'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CEO' as never,
      commandId: 'c1',
    });

    expect(router.dispatch).toHaveBeenCalledTimes(5);
    // IMPACT 는 --recent 7d 인자로 호출된다
    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTypeHint: 'IMPACT_REPORTER',
        text: '--recent 7d',
        source: 'REMOTE_CONSOLE',
      }),
    );
    // 진행 안내(command.info)가 최소 2회(PO_EVAL, IMPACT)
    const infos = consoleEvents.publish.mock.calls
      .map((c) => c[0])
      .filter((e) => e.type === 'command.info');
    expect(infos.length).toBeGreaterThanOrEqual(2);
  });

  it('NO_ASSIGNABLE_TASKS 는 재시도 없이 즉시 command.rejected', async () => {
    const { orchestrator, router, consoleEvents } = make();
    router.dispatch.mockRejectedValue(
      new FakeDomainException(CtoErrorCode.NO_ASSIGNABLE_TASKS),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CTO' as never,
      commandId: 'c1',
    });

    expect(router.dispatch).toHaveBeenCalledTimes(1);
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected', commandId: 'c1' }),
    );
  });

  it('선행 생성 실패(IMPACT env 없음)면 체인 경로와 함께 rejected, 상위 재시도 안 함', async () => {
    const { orchestrator, router, consoleEvents } = make('7');
    router.dispatch
      .mockRejectedValueOnce(new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN))
      .mockRejectedValueOnce(
        new FakeDomainException(PoEvalErrorCode.NO_SUB_AGENT_RUNS),
      )
      .mockRejectedValueOnce(
        new FakeDomainException('IMPACT_REPORTER_RECENT_MODE_ENV_MISSING'),
      );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CEO' as never,
      commandId: 'c1',
    });

    // CEO → PO_EVAL → IMPACT(실패) 3회, 원래 worker 재시도 없음
    expect(router.dispatch).toHaveBeenCalledTimes(3);
    const rejected = consoleEvents.publish.mock.calls
      .map((c) => c[0])
      .find((e) => e.type === 'command.rejected');
    expect(rejected).toBeDefined();
  });

  it('commandId 없으면 SSE 를 발행하지 않는다', async () => {
    const { orchestrator, router, consoleEvents } = make();
    router.dispatch.mockRejectedValue(
      new FakeDomainException(CtoErrorCode.NO_ASSIGNABLE_TASKS),
    );

    await orchestrator.run({ slackUserId: 'U1', agentTypeHint: 'CTO' as never });

    expect(consoleEvents.publish).not.toHaveBeenCalled();
  });

  it('매핑에 없는 도메인 예외는 원래 메시지로 rejected', async () => {
    const { orchestrator, router, consoleEvents } = make();
    router.dispatch.mockRejectedValue(new FakeDomainException('PARSE_FAILED'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CEO' as never,
      commandId: 'c1',
    });

    expect(router.dispatch).toHaveBeenCalledTimes(1);
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected', commandId: 'c1' }),
    );
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `pnpm exec jest src/console/application/precondition-chain.orchestrator.spec.ts`
Expected: FAIL ("PreconditionChainOrchestrator is not a constructor" 또는 모듈 없음)

- [ ] **Step 3: 오케스트레이터 구현**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainException } from '../../common/exception/domain.exception';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { resolveChain } from '../domain/precondition-chain.map';
import { ConsoleEventBus } from './console-event-bus.service';

const MAX_CHAIN_DEPTH = 3;
const DEFAULT_IMPACT_RECENT_DAYS = 7;

export interface ConsoleChainInput {
  slackUserId: string;
  text?: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}

interface ChainState {
  depth: number;
  visited: AgentType[];
}

type ChainOutcome = { ok: true } | { ok: false; reason: string };

// 콘솔 리모컨 2A.2 — 역방향 선행 트리거 오케스트레이터(REMOTE_CONSOLE 국한).
// precondition 예외는 LLM 호출 전에 발생하므로 실패한 dispatch 는 codex 를 쓰지 않는다.
@Injectable()
export class PreconditionChainOrchestrator {
  private readonly logger = new Logger(PreconditionChainOrchestrator.name);

  constructor(
    @Inject(IDAERI_ROUTER_PORT)
    private readonly router: IdaeriRouterPort,
    private readonly consoleEvents: ConsoleEventBus,
    private readonly config: ConfigService,
  ) {}

  async run(input: ConsoleChainInput): Promise<void> {
    await this.runChain(input, { depth: 0, visited: [] });
  }

  private async runChain(
    input: ConsoleChainInput,
    chain: ChainState,
  ): Promise<ChainOutcome> {
    try {
      const result = await this.router.dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId: input.slackUserId,
        text: input.text,
        agentTypeHint: input.agentTypeHint,
      });
      if (input.commandId && result.autoResolvedNotice) {
        this.consoleEvents.publish({
          type: 'command.info',
          commandId: input.commandId,
          message: result.autoResolvedNotice,
        });
      }
      return { ok: true };
    } catch (error: unknown) {
      if (!(error instanceof DomainException)) {
        const reason = error instanceof Error ? error.message : String(error);
        return this.reject(input, chain, reason);
      }
      const resolution = resolveChain(error.errorCode);
      if (!resolution || resolution.kind === 'UNRESOLVABLE') {
        return this.reject(input, chain, error.message);
      }
      if (chain.visited.includes(resolution.prereqWorker)) {
        return this.reject(
          input,
          chain,
          `순환 감지: ${resolution.prereqWorker} 재진입`,
        );
      }
      if (chain.depth + 1 > MAX_CHAIN_DEPTH) {
        return this.reject(input, chain, '자동 체이닝 깊이 초과');
      }
      if (input.commandId) {
        this.consoleEvents.publish({
          type: 'command.info',
          commandId: input.commandId,
          message: `${resolution.failedWorkerLabel} 실행에 필요한 ${resolution.prereqWorker} 선행이 없어 먼저 실행합니다.`,
        });
      }
      const prereqInput: ConsoleChainInput = {
        slackUserId: input.slackUserId,
        agentTypeHint: resolution.prereqWorker,
        text: resolution.needsRecentArg
          ? `--recent ${this.impactRecentDays()}d`
          : undefined,
        commandId: input.commandId,
      };
      const prereqOutcome = await this.runChain(prereqInput, {
        depth: chain.depth + 1,
        visited: [...chain.visited, resolution.prereqWorker],
      });
      if (!prereqOutcome.ok) {
        return prereqOutcome; // 선행 실패 → 상위 재시도 중단
      }
      return this.runChain(input, chain); // 선행 성공 → 원래 worker 재시도
    }
  }

  private reject(
    input: ConsoleChainInput,
    chain: ChainState,
    reason: string,
  ): ChainOutcome {
    const path = [
      String(input.agentTypeHint ?? input.text ?? '(자연어)'),
      ...chain.visited,
    ].join(' ← ');
    this.logger.warn(`콘솔 체이닝 중단 — ${path}: ${reason}`);
    if (input.commandId) {
      this.consoleEvents.publish({
        type: 'command.rejected',
        commandId: input.commandId,
        reason: `${path}: ${reason}`,
      });
    }
    return { ok: false, reason };
  }

  private impactRecentDays(): number {
    const raw = this.config.get<string>('CONSOLE_CHAIN_IMPACT_RECENT_DAYS');
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_IMPACT_RECENT_DAYS;
  }
}
```

- [ ] **Step 4: 테스트 실행 → PASS 확인**

Run: `pnpm exec jest src/console/application/precondition-chain.orchestrator.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: lint 확인**

Run: `pnpm lint:check`
Expected: 0 errors

- [ ] **Step 6: 커밋**

```bash
git add src/console/application/precondition-chain.orchestrator.ts src/console/application/precondition-chain.orchestrator.spec.ts
git commit -m "feat(console): 2A.2 역방향 선행 트리거 오케스트레이터

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ConsoleWriteService 위임 전환

**Files:**
- Modify: `src/console/application/console-write.service.ts`
- Modify(Test): `src/console/application/console-write.service.spec.ts`

**Interfaces:**
- Consumes: `PreconditionChainOrchestrator`(Task 2) — `run(input: ConsoleChainInput): Promise<void>`
- Produces: `ConsoleWriteService.sendCommand(input)` 동작 불변(외부 계약 동일), 내부만 orchestrator 위임.

**설명:** `sendCommand`의 `router.dispatch(...).then/.catch` 블록을 orchestrator 위임으로 대체한다. SSE(성공 info/실패 rejected) 방출 책임이 orchestrator로 이동하므로 service의 `.then/.catch`는 제거한다. owner 주입·fire-and-forget(void)·`applyApproval`/`cancelApproval`은 불변. router는 orchestrator가 주입받으므로 service 생성자에서 제거하고 orchestrator를 주입한다.

- [ ] **Step 1: 기존 spec 갱신 (dispatch 직접 검증 → orchestrator 위임 검증)**

`console-write.service.spec.ts`의 `makeService`에서 `router` mock을 `chainOrchestrator` mock으로 교체하고, dispatch 관련 3개 테스트(REMOTE_CONSOLE 위임/fire-and-forget/command.rejected/command.info)를 orchestrator 위임 검증으로 바꾼다. approval 테스트는 불변.

```ts
function makeService(owner?: string) {
  const config = {
    get: (key: string) =>
      key === 'CONSOLE_OWNER_SLACK_USER_ID' ? owner : undefined,
  } as unknown as ConfigService;
  const chainOrchestrator = { run: jest.fn().mockResolvedValue(undefined) };
  const applyPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const cancelPreview = { execute: jest.fn().mockResolvedValue(undefined) };
  const service = new ConsoleWriteService(
    config,
    chainOrchestrator as never,
    applyPreview as never,
    cancelPreview as never,
  );
  return { service, chainOrchestrator, applyPreview, cancelPreview };
}
```

교체할 dispatch 테스트(3개를 아래 2개로 정리):

```ts
it('owner 설정 시 orchestrator 에 REMOTE_CONSOLE 지시를 위임한다', () => {
  const { service, chainOrchestrator } = makeService(OWNER);
  service.sendCommand({
    text: '오늘 할 일 정리',
    agentTypeHint: 'PM' as never,
    commandId: 'c1',
  });
  expect(chainOrchestrator.run).toHaveBeenCalledWith({
    slackUserId: OWNER,
    text: '오늘 할 일 정리',
    agentTypeHint: 'PM',
    commandId: 'c1',
  });
});

it('owner 미설정 시 sendCommand 는 ServiceUnavailableException', () => {
  const { service } = makeService(undefined);
  expect(() => service.sendCommand({ text: 'x' })).toThrow(
    ServiceUnavailableException,
  );
});
```

(command.rejected/command.info 발행 검증은 Task 2의 orchestrator spec으로 이관됐으므로 여기서 제거.)

- [ ] **Step 2: 테스트 실행 → FAIL 확인**

Run: `pnpm exec jest src/console/application/console-write.service.spec.ts`
Expected: FAIL (생성자 시그니처 불일치)

- [ ] **Step 3: console-write.service.ts 수정**

```ts
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import { PreconditionChainOrchestrator } from './precondition-chain.orchestrator';

interface ConsoleCommandInput {
  text: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}

// 콘솔 리모컨 write 위임 서비스. owner 를 주입해 orchestrator 로 넘긴다.
// 지시는 codex 지연(10~40s) + 자동 체이닝 때문에 await 하지 않고 백그라운드 실행 → 진행은 SSE 로 반영.
@Injectable()
export class ConsoleWriteService {
  private readonly logger = new Logger(ConsoleWriteService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chainOrchestrator: PreconditionChainOrchestrator,
    private readonly applyPreview: ApplyPreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
  ) {}

  sendCommand(input: ConsoleCommandInput): void {
    const slackUserId = this.requireOwner();
    void this.chainOrchestrator
      .run({
        slackUserId,
        text: input.text,
        agentTypeHint: input.agentTypeHint,
        commandId: input.commandId,
      })
      .catch((error: unknown) => {
        // orchestrator 는 도메인 예외를 SSE 로 처리한다. 여기 도달하면 예기치 못한 내부 오류.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`리모컨 지시 처리 중 예기치 못한 오류: ${reason}`);
      });
  }

  async applyApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.applyPreview.execute({ previewId, slackUserId });
  }

  async cancelApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.cancelPreview.execute({ previewId, slackUserId });
  }

  private requireOwner(): string {
    const owner = this.config.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    if (!owner) {
      throw new ServiceUnavailableException(
        'CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않아 콘솔 지시/승인을 처리할 수 없습니다.',
      );
    }
    return owner;
  }
}
```

- [ ] **Step 4: 테스트 실행 → PASS 확인**

Run: `pnpm exec jest src/console/application/console-write.service.spec.ts`
Expected: PASS

- [ ] **Step 5: lint 확인**

Run: `pnpm lint:check`
Expected: 0 errors

- [ ] **Step 6: 커밋**

```bash
git add src/console/application/console-write.service.ts src/console/application/console-write.service.spec.ts
git commit -m "refactor(console): 2A.2 write service 를 체이닝 오케스트레이터에 위임

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 모듈 등록 + env 동기

**Files:**
- Modify: `src/console/console.module.ts`
- Modify: `src/config/app.config.ts`
- Modify: `.env.example`, `.env`, `README.md`

**설명:** orchestrator를 provider로 등록하고, 새 env `CONSOLE_CHAIN_IMPACT_RECENT_DAYS`를 4곳에 선언한다. 배선·설정 태스크라 단위테스트 없음 — `pnpm build`로 DI/타입 검증.

- [ ] **Step 1: console.module.ts 에 orchestrator 등록**

`providers` 배열에 `PreconditionChainOrchestrator` 추가(import 포함). `RouterModule`(IDAERI_ROUTER_PORT 제공), `ConsoleEventBus`(@Global) 는 이미 주입 가능.

```ts
import { PreconditionChainOrchestrator } from './application/precondition-chain.orchestrator';
// ...
  providers: [
    ConsoleReadService,
    ConsoleWriteService,
    ConsoleWriteGuard,
    PreconditionChainOrchestrator,
  ],
```

- [ ] **Step 2: app.config.ts 에 env 추가**

기존 `@IsOptional() @IsString()` 패턴을 따른다(env 는 문자열로 유입, orchestrator 가 런타임 파싱). AUTOPILOT 블록 근처에 추가.

```ts
  // 콘솔 리모컨 2A.2 — PO_EVAL 자동 체이닝 시 IMPACT_REPORTER --recent 조회 일수. 기본 7.
  @IsOptional()
  @IsString()
  CONSOLE_CHAIN_IMPACT_RECENT_DAYS?: string;
```

- [ ] **Step 3: .env.example / .env / README 동기**

`.env.example`, `.env` 에 추가:

```
# 콘솔 리모컨 2A.2 — PO_EVAL 자동 체이닝 시 IMPACT_REPORTER --recent 조회 일수(기본 7)
CONSOLE_CHAIN_IMPACT_RECENT_DAYS=7
```

README 의 env 표에 `CONSOLE_CHAIN_IMPACT_RECENT_DAYS` 행 추가(설명: 콘솔 자동 체이닝의 IMPACT_REPORTER recent 조회 일수, 기본 7).

- [ ] **Step 4: 전체 검증 (build + 전체 test + lint)**

```bash
pnpm lint:check
pnpm build
pnpm test
```
Expected: 3종 모두 green. (전체 test 로 포트 확장·mock 회귀 없음 확인 — 신규 provider 주입 정상.)

- [ ] **Step 5: 커밋**

```bash
git add src/console/console.module.ts src/config/app.config.ts .env.example README.md
git commit -m "feat(console): 2A.2 orchestrator 등록 + CONSOLE_CHAIN_IMPACT_RECENT_DAYS env

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(주: `.env` 는 gitignore — 커밋 대상 아님. 로컬만 갱신.)

---

## 최종 검증 (전체 완료 후)

- [ ] `pnpm lint:check && pnpm build && pnpm test` 3종 green
- [ ] `git log --oneline` 로 4개 Task 커밋 확인
- [ ] 라우터·usecase·dispatcher·Slack 경로 diff 0 확인 (`git diff main --stat` 에 해당 경로 없음)

## Self-Review (플랜↔spec 대조)

- **스코프(REMOTE_CONSOLE 국한)**: Task 2 orchestrator가 `source:'REMOTE_CONSOLE'` 고정, Slack 경로 미수정 → 충족.
- **전체 재귀**: Task 2 `runChain` 재귀 + IMPACT `--recent` 인자 합성 → 충족.
- **접근법 B(에러 기반)**: `DomainException.errorCode` catch → `resolveChain` → 충족.
- **매핑 6종**: Task 1 테이블 5 PREREQ + 1 UNRESOLVABLE → 충족.
- **인자 합성(IMPACT --recent {N}d)**: Task 2 `impactRecentDays()` + Task 4 env → 충족.
- **재사용(선행 있으면 미발동)**: `runChain` 첫 dispatch 성공 시 즉시 return → 충족.
- **진행/실패 SSE**: Task 2 `command.info`(선행 트리거 전) / `command.rejected`(체인 경로 포함) → 충족.
- **엣지(NO_ASSIGNABLE_TASKS·commandId 없음·매핑 없음)**: Task 2 테스트 (c)(e)(g) → 충족.
- **타입 일관성**: `ConsoleChainInput`(Task 2 정의)을 Task 3 service가 동일 필드로 호출 → 일치.
