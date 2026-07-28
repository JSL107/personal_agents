import { ConfigService } from '@nestjs/config';

import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import * as preconditionChainMap from '../domain/precondition-chain.map';
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
      .mockRejectedValueOnce(
        new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN),
      )
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
    expect(router.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        agentTypeHint: 'IMPACT_REPORTER',
        text: '--recent 7d',
        source: 'REMOTE_CONSOLE',
      }),
    );
    const infos = consoleEvents.publish.mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === 'command.info');
    expect(infos.length).toBeGreaterThanOrEqual(2);
  });

  it('선행 성공 후 같은 선행을 다시 요구하면 재실행 없이 순환 rejected 한다', async () => {
    const { orchestrator, router, consoleEvents } = make();
    router.dispatch
      .mockRejectedValueOnce(
        new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN),
      )
      .mockResolvedValueOnce(ok('PO_EVAL'))
      .mockRejectedValueOnce(
        new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN),
      )
      .mockRejectedValueOnce(new Error('반복 방지 실패'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: AgentType.CEO,
      commandId: 'c1',
    });

    expect(router.dispatch).toHaveBeenCalledTimes(3);
    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.rejected',
      commandId: 'c1',
      reason: 'CEO ← PO_EVAL: 순환 감지: PO_EVAL 재진입',
    });
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
      .mockRejectedValueOnce(
        new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN),
      )
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

    expect(router.dispatch).toHaveBeenCalledTimes(3);
    const rejected = consoleEvents.publish.mock.calls
      .map((call) => call[0])
      .find((event) => event.type === 'command.rejected');
    expect(rejected).toEqual({
      type: 'command.rejected',
      commandId: 'c1',
      reason:
        'CEO ← PO_EVAL ← IMPACT_REPORTER: 도메인 오류: IMPACT_REPORTER_RECENT_MODE_ENV_MISSING',
    });
  });

  it('순환하는 선행 조건은 재진입 전에 command.rejected 한다', async () => {
    const { orchestrator, router, consoleEvents } = make();
    const resolveChainSpy = jest
      .spyOn(preconditionChainMap, 'resolveChain')
      .mockImplementation((errorCode) => {
        const prereqWorker =
          errorCode === 'CHAIN_CEO'
            ? AgentType.PM
            : errorCode === 'CHAIN_PM'
              ? AgentType.CEO
              : AgentType.PM;
        return {
          kind: 'PREREQ',
          failedWorkerLabel: 'test',
          prereqWorker,
        };
      });
    router.dispatch
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_CEO'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_PM'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_CYCLE'));

    try {
      await orchestrator.run({
        slackUserId: 'U1',
        agentTypeHint: AgentType.CEO,
        commandId: 'c1',
      });

      expect(router.dispatch).toHaveBeenCalledTimes(3);
      expect(consoleEvents.publish).toHaveBeenCalledWith({
        type: 'command.rejected',
        commandId: 'c1',
        reason: 'CEO ← PM ← CEO: 순환 감지: PM 재진입',
      });
    } finally {
      resolveChainSpy.mockRestore();
    }
  });

  it('선행 체인이 최대 깊이를 넘으면 다음 선행을 실행하지 않고 rejected 한다', async () => {
    const { orchestrator, router, consoleEvents } = make();
    const prereqWorkers: Record<string, AgentType> = {
      CHAIN_1: AgentType.PM,
      CHAIN_2: AgentType.CTO,
      CHAIN_3: AgentType.PO_SHADOW,
      CHAIN_4: AgentType.PO_EVAL,
    };
    const resolveChainSpy = jest
      .spyOn(preconditionChainMap, 'resolveChain')
      .mockImplementation((errorCode) => {
        const prereqWorker = prereqWorkers[errorCode];
        return prereqWorker
          ? {
              kind: 'PREREQ',
              failedWorkerLabel: 'test',
              prereqWorker,
            }
          : undefined;
      });
    router.dispatch
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_1'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_2'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_3'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_4'));

    try {
      await orchestrator.run({
        slackUserId: 'U1',
        agentTypeHint: AgentType.CEO,
        commandId: 'c1',
      });

      expect(router.dispatch).toHaveBeenCalledTimes(4);
      expect(consoleEvents.publish).toHaveBeenCalledWith({
        type: 'command.rejected',
        commandId: 'c1',
        reason: 'CEO ← PM ← CTO ← PO_SHADOW: 자동 체이닝 깊이 초과',
      });
    } finally {
      resolveChainSpy.mockRestore();
    }
  });

  it.each([
    ['설정 누락', undefined],
    ['잘못된 설정', 'invalid'],
  ])(
    'IMPACT recent days %s 시 --recent 7d를 사용한다',
    async (_, recentDays) => {
      const { orchestrator, router } = make(recentDays);
      router.dispatch
        .mockRejectedValueOnce(
          new FakeDomainException(PoEvalErrorCode.NO_SUB_AGENT_RUNS),
        )
        .mockResolvedValueOnce(ok('IMPACT_REPORTER'))
        .mockResolvedValueOnce(ok('PO_EVAL'));

      await orchestrator.run({
        slackUserId: 'U1',
        agentTypeHint: AgentType.PO_EVAL,
      });

      expect(router.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          agentTypeHint: AgentType.IMPACT_REPORTER,
          text: '--recent 7d',
        }),
      );
    },
  );

  it('commandId 없으면 SSE 를 발행하지 않는다', async () => {
    const { orchestrator, router, consoleEvents } = make();
    router.dispatch.mockRejectedValue(
      new FakeDomainException(CtoErrorCode.NO_ASSIGNABLE_TASKS),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CTO' as never,
    });

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
