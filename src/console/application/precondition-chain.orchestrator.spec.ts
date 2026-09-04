import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { CtoErrorCode } from '../../agent/cto/domain/cto-error-code.enum';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ConversationMemoryService } from '../../router/application/conversation-memory.service';
import {
  ConversationalReplyFailedException,
  HandleConversationTurnUsecase,
} from '../../router/application/handle-conversation-turn.usecase';
import { buildDispatchReplyText } from '../../router/domain/dispatch-reply.util';
import * as preconditionChainMap from '../domain/precondition-chain.map';
import { ConsoleEventBus } from './console-event-bus.service';
import { PreconditionChainOrchestrator } from './precondition-chain.orchestrator';

class FakeDomainException extends DomainException {
  readonly errorCode: string;
  readonly status: DomainStatus;

  constructor(
    code: string,
    status: DomainStatus = DomainStatus.NOT_FOUND,
    message = `도메인 오류: ${code}`,
  ) {
    super(message);
    this.errorCode = code;
    this.status = status;
  }
}

function make(recentDays?: string) {
  const config = {
    get: (key: string) =>
      key === 'CONSOLE_CHAIN_IMPACT_RECENT_DAYS' ? recentDays : undefined,
  } as unknown as ConfigService;
  const handleConversationTurn = { execute: jest.fn() };
  const conversationMemory = {
    buildKey: jest.fn(
      ({ slackUserId, channelId }) => `${slackUserId}:${channelId}`,
    ),
    appendTurn: jest.fn().mockResolvedValue(undefined),
  };
  const consoleEvents = { publish: jest.fn() };
  const suggestNextWork = {
    execute: jest.fn().mockResolvedValue({
      suggestions: [],
      skippedUnknownCycle: 0,
      alsoDueCount: 0,
    }),
  };
  const pendingTurns = {
    putSuggestions: jest.fn(),
    putAwaitingInput: jest.fn(),
  };
  const findLatestPendingPreview = {
    execute: jest.fn().mockResolvedValue(null),
  };
  const applyPreview = { execute: jest.fn() };
  const cancelPreview = { execute: jest.fn() };
  const orchestrator = new PreconditionChainOrchestrator(
    handleConversationTurn as unknown as HandleConversationTurnUsecase,
    conversationMemory as unknown as ConversationMemoryService,
    consoleEvents as unknown as ConsoleEventBus,
    config,
    suggestNextWork as never,
    pendingTurns as never,
    findLatestPendingPreview as never,
    applyPreview as never,
    cancelPreview as never,
  );
  return {
    orchestrator,
    handleConversationTurn,
    conversationMemory,
    consoleEvents,
    suggestNextWork,
    pendingTurns,
    findLatestPendingPreview,
    applyPreview,
    cancelPreview,
  };
}

function ok(workerType: string) {
  return {
    kind: 'WORKER_RAN' as const,
    result: {
      agentRunId: 1,
      workerType,
      output: {},
      modelUsed: 'codex',
      formattedText: '완료',
    },
  };
}

function okWithText(workerType: string, formattedText: string) {
  const outcome = ok(workerType);
  return {
    ...outcome,
    result: {
      ...outcome.result,
      formattedText,
    },
  };
}

describe('PreconditionChainOrchestrator', () => {
  it('분류 실패 대화 응답을 CONSOLE 격리 key로 command.answered 발행한다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      conversationMemory,
      consoleEvents,
      suggestNextWork,
    } = make();
    handleConversationTurn.execute.mockResolvedValue({
      kind: 'REPLIED',
      text: '무엇을 도와드릴지 말씀해주세요.',
    });

    await orchestrator.run({
      slackUserId: 'U1',
      text: '지금 하고 싶은 일이 있어?',
      commandId: 'c1',
    });

    expect(conversationMemory.buildKey).toHaveBeenCalledWith({
      slackUserId: 'U1',
      channelId: 'CONSOLE',
    });
    expect(handleConversationTurn.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      conversationKey: 'U1:CONSOLE',
      text: '지금 하고 싶은 일이 있어?',
      source: 'REMOTE_CONSOLE',
      agentTypeHint: undefined,
      // 사용자가 직접 말한 turn 이므로 기억한다. 선행 worker 만 false.
      shouldRemember: true,
    });
    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.answered',
      commandId: 'c1',
      message: '무엇을 도와드릴지 말씀해주세요.',
    });
    expect(suggestNextWork.execute).not.toHaveBeenCalled();
    expect(consoleEvents.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected' }),
    );
  });

  it.each([
    ['undefined', undefined],
    ['trim 후 빈 문자열', '   '],
  ])(
    'text가 %s인 지목 worker의 BAD_REQUEST는 원본 메시지를 숨기고 입력을 되묻는다',
    async (_, text) => {
      const {
        orchestrator,
        handleConversationTurn,
        consoleEvents,
        pendingTurns,
      } = make();
      const originalMessage =
        '오늘 한 일이 비어 있습니다. `/worklog <오늘 한 일>` 형식으로 입력해주세요.';
      handleConversationTurn.execute.mockRejectedValue(
        new FakeDomainException(
          'WORKLOG_INPUT_REQUIRED',
          DomainStatus.BAD_REQUEST,
          originalMessage,
        ),
      );

      await orchestrator.run({
        slackUserId: 'U1',
        agentTypeHint: AgentType.WORK_REVIEWER,
        text,
        commandId: 'c1',
      });

      expect(pendingTurns.putAwaitingInput).toHaveBeenCalledWith('U1', {
        agentType: AgentType.WORK_REVIEWER,
        displayName: 'Work Reviewer',
      });
      const answeredEvent = consoleEvents.publish.mock.calls
        .map((call) => call[0])
        .find((event) => event.type === 'command.answered');
      expect(answeredEvent).toEqual({
        type: 'command.answered',
        commandId: 'c1',
        message:
          '「Work Reviewer」에 무엇을 맡길지 한 줄로 알려주세요. 적어주시면 그대로 시작할게요. (지금 적는 말은 Work Reviewer 에게 그대로 전달됩니다)',
      });
      expect(answeredEvent.message).not.toContain(originalMessage);
      expect(answeredEvent.message).not.toContain('/');
      expect(consoleEvents.publish).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'command.rejected' }),
      );
    },
  );

  it('text가 있으면 같은 BAD_REQUEST도 기존처럼 command.rejected를 발행한다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      consoleEvents,
      pendingTurns,
    } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new FakeDomainException(
        'WORKLOG_INPUT_REQUIRED',
        DomainStatus.BAD_REQUEST,
      ),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: AgentType.WORK_REVIEWER,
      text: '오늘 한 일',
      commandId: 'c1',
    });

    expect(pendingTurns.putAwaitingInput).not.toHaveBeenCalled();
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected', commandId: 'c1' }),
    );
  });

  it('빈 text의 BAD_REQUEST라도 선행 체이닝 가능하면 되묻기보다 체이닝한다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      consoleEvents,
      pendingTurns,
    } = make();
    handleConversationTurn.execute
      .mockRejectedValueOnce(
        new FakeDomainException(
          CeoErrorCode.NO_PO_EVAL_RUN,
          DomainStatus.BAD_REQUEST,
        ),
      )
      .mockResolvedValueOnce(ok('PO_EVAL'))
      .mockResolvedValueOnce(ok('CEO'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: AgentType.CEO,
      commandId: 'c1',
    });

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(3);
    expect(pendingTurns.putAwaitingInput).not.toHaveBeenCalled();
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.info', commandId: 'c1' }),
    );
  });

  it('BAD_REQUEST가 아니면 빈 text와 agentTypeHint가 있어도 기존 rejected다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      consoleEvents,
      pendingTurns,
    } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new FakeDomainException('WORKER_FAILED', DomainStatus.NOT_FOUND),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: AgentType.WORK_REVIEWER,
      commandId: 'c1',
    });

    expect(pendingTurns.putAwaitingInput).not.toHaveBeenCalled();
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected', commandId: 'c1' }),
    );
  });

  it('대화 응답까지 실패하면 제안 목록과 남은 due 수를 발행한다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      consoleEvents,
      suggestNextWork,
    } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new ConversationalReplyFailedException(new Error('대화 응답 실패')),
    );
    suggestNextWork.execute.mockResolvedValue({
      suggestions: [
        {
          agentType: AgentType.PM,
          displayName: 'PM',
          reason: '마지막 성공 2일 전 · 평소 1일 주기',
        },
      ],
      skippedUnknownCycle: 0,
      alsoDueCount: 2,
    });

    await orchestrator.run({
      slackUserId: 'U1',
      text: '지금 할 일 있어?',
      commandId: 'c1',
    });

    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.answered',
      commandId: 'c1',
      message:
        '지금 시킬 만한 일이에요. 번호로 답해주세요.\n1. PM — 마지막 성공 2일 전 · 평소 1일 주기\n그 외 2개도 때가 됐어요.',
    });
  });

  it('대화 응답 실패 뒤 제안도 없으면 내부 worker·분류 용어 없이 rejected 한다', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new ConversationalReplyFailedException(new Error('대화 응답 실패')),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      text: '지금 할 일 있어?',
      commandId: 'c1',
    });

    const rejectedEvent = consoleEvents.publish.mock.calls
      .map((call) => call[0])
      .find((event) => event.type === 'command.rejected');
    expect(rejectedEvent.reason).toContain(
      '지금 새로 시킬 만한 일을 찾지 못했습니다.',
    );
    expect(rejectedEvent.reason).not.toMatch(/worker|분류/);
  });

  it('제안 계산 실패는 내부 오류를 숨기고 고정 문구로 command.rejected를 발행한다', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const {
      orchestrator,
      handleConversationTurn,
      consoleEvents,
      suggestNextWork,
    } = make();
    const internalMessage = 'Prisma connection pool timeout at agent_run';
    handleConversationTurn.execute.mockRejectedValue(
      new ConversationalReplyFailedException(new Error('대화 응답 실패')),
    );
    suggestNextWork.execute.mockRejectedValue(new Error(internalMessage));

    try {
      await orchestrator.run({
        slackUserId: 'U1',
        text: '지금 할 일 있어?',
        commandId: 'c1',
      });

      const rejectedEvent = consoleEvents.publish.mock.calls
        .map((call) => call[0])
        .find((event) => event.type === 'command.rejected');
      expect(rejectedEvent).toEqual({
        type: 'command.rejected',
        commandId: 'c1',
        reason:
          '지금 할 일 있어?: 지금 할 일을 추려보지 못했어요. 잠시 후 다시 말 걸어주세요.',
      });
      expect(rejectedEvent.reason).not.toContain(internalMessage);
      expect(warnSpy).toHaveBeenCalledWith(
        `콘솔 할 일 제안 실패 — ${internalMessage}`,
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('선행이 이미 있으면 체이닝 없이 단일 dispatch 로 성공한다', async () => {
    const { orchestrator, handleConversationTurn } = make();
    handleConversationTurn.execute.mockResolvedValue(ok('CEO'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CEO' as never,
      commandId: 'c1',
    });

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['7999자', 7999, false],
    ['8000자', 8000, false],
    ['8001자', 8001, true],
  ])('worker 산출물 %s의 8000자 상한을 지킨다', async (_, length) => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    const formattedText = '가'.repeat(length);
    handleConversationTurn.execute.mockResolvedValue(
      okWithText('PM', formattedText),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      text: '계획 짜줘',
      commandId: 'c1',
    });

    const reply = buildDispatchReplyText({
      agentRunId: 1,
      workerType: 'PM' as never,
      output: {},
      modelUsed: 'codex',
      formattedText,
    });
    const expectedMessage =
      reply.length > 8000
        ? `${reply.slice(0, 8000)}\n\n…(길어서 여기까지만 보여드려요)`
        : reply;
    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.answered',
      commandId: 'c1',
      message: expectedMessage,
    });
  });

  it('pending preview에 응답한 응은 apply하고 dispatch하지 않는다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      findLatestPendingPreview,
      applyPreview,
      consoleEvents,
    } = make();
    findLatestPendingPreview.execute.mockResolvedValue({
      id: 'p1',
      kind: 'CAREER_PROFILE',
      status: 'PENDING',
    });
    applyPreview.execute.mockResolvedValue({ resultText: '반영했습니다.' });

    await orchestrator.run({ slackUserId: 'U1', text: '응', commandId: 'c1' });

    expect(applyPreview.execute).toHaveBeenCalledWith({
      previewId: 'p1',
      slackUserId: 'U1',
    });
    expect(handleConversationTurn.execute).not.toHaveBeenCalled();
    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.answered',
      commandId: 'c1',
      message: '✅ 적용 완료 (CAREER_PROFILE)\n\n반영했습니다.',
    });
  });

  it('pending preview에 응답한 아니는 cancel하고 dispatch하지 않는다', async () => {
    const {
      orchestrator,
      handleConversationTurn,
      findLatestPendingPreview,
      cancelPreview,
    } = make();
    findLatestPendingPreview.execute.mockResolvedValue({
      id: 'p1',
      kind: 'CAREER_PROFILE',
      status: 'PENDING',
    });

    await orchestrator.run({
      slackUserId: 'U1',
      text: '아니',
      commandId: 'c1',
    });

    expect(cancelPreview.execute).toHaveBeenCalledWith({
      previewId: 'p1',
      slackUserId: 'U1',
    });
    expect(handleConversationTurn.execute).not.toHaveBeenCalled();
  });

  it('preview 조회가 실패하면 인터셉트를 포기하고 일반 dispatch로 폴백한다', async () => {
    const { orchestrator, handleConversationTurn, findLatestPendingPreview } =
      make();
    findLatestPendingPreview.execute.mockRejectedValue(
      new Error('preview 저장소 장애'),
    );
    handleConversationTurn.execute.mockResolvedValue(ok('PM'));
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    try {
      await orchestrator.run({
        slackUserId: 'U1',
        text: '응',
        commandId: 'c1',
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(1);
  });

  it('기억 저장이 실패해도 apply 성공을 answered로 발행한다', async () => {
    const {
      orchestrator,
      conversationMemory,
      findLatestPendingPreview,
      applyPreview,
      consoleEvents,
    } = make();
    findLatestPendingPreview.execute.mockResolvedValue({
      id: 'p1',
      kind: 'CAREER_PROFILE',
      status: 'PENDING',
    });
    applyPreview.execute.mockResolvedValue({ resultText: '반영했습니다.' });
    conversationMemory.appendTurn.mockRejectedValue(new Error('redis down'));
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    try {
      await orchestrator.run({
        slackUserId: 'U1',
        text: '응',
        commandId: 'c1',
      });
    } finally {
      warnSpy.mockRestore();
    }

    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.answered',
      commandId: 'c1',
      message: '✅ 적용 완료 (CAREER_PROFILE)\n\n반영했습니다.',
    });
    expect(consoleEvents.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected' }),
    );
  });

  it('preview가 없으면 일반 dispatch를 수행한다', async () => {
    const { orchestrator, handleConversationTurn } = make();
    handleConversationTurn.execute.mockResolvedValue(ok('PM'));

    await orchestrator.run({ slackUserId: 'U1', text: '응', commandId: 'c1' });

    expect(handleConversationTurn.execute).toHaveBeenCalled();
  });

  it('긴 응답 문장은 yes/no 인터셉트 없이 일반 dispatch를 수행한다', async () => {
    const { orchestrator, handleConversationTurn, findLatestPendingPreview } =
      make();
    findLatestPendingPreview.execute.mockResolvedValue({
      id: 'p1',
      kind: 'CAREER_PROFILE',
      status: 'PENDING',
    });
    handleConversationTurn.execute.mockResolvedValue(ok('PM'));

    await orchestrator.run({
      slackUserId: 'U1',
      text: '응 그리고 이 내용도 함께 검토해서 다음 작업으로 진행해 주세요',
      commandId: 'c1',
    });

    expect(handleConversationTurn.execute).toHaveBeenCalled();
  });

  it('CAREER_JD_GAP_BLOG의 응은 일반 dispatch로 통과한다', async () => {
    const { orchestrator, handleConversationTurn, findLatestPendingPreview } =
      make();
    findLatestPendingPreview.execute.mockResolvedValue({
      id: 'p1',
      kind: 'CAREER_JD_GAP_BLOG',
      status: 'PENDING',
    });
    handleConversationTurn.execute.mockResolvedValue(ok('PM'));

    await orchestrator.run({ slackUserId: 'U1', text: '응', commandId: 'c1' });

    expect(handleConversationTurn.execute).toHaveBeenCalled();
  });

  it('선행 worker 산출물은 숨기고 최종 worker 산출물만 answered 발행한다', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    handleConversationTurn.execute
      .mockRejectedValueOnce(
        new FakeDomainException(CeoErrorCode.NO_PO_EVAL_RUN),
      )
      .mockResolvedValueOnce(okWithText('PO_EVAL', '선행 산출물'))
      .mockResolvedValueOnce(okWithText('CEO', '최종 산출물'));

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: AgentType.CEO,
      commandId: 'c1',
    });

    const answeredMessages = consoleEvents.publish.mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === 'command.answered')
      .map((event) => event.message);
    expect(answeredMessages).toEqual([
      '최종 산출물\n\n_이대리 (CEO) · agentRunId=1_',
    ]);

    // 산출물을 숨기는 것과 같은 이유로 기억에서도 뺀다 — 사용자가 말하지도 보지도 않은 turn 이
    // 5턴 한도를 먹으면 실제 발화가 밀려난다. 선행(PO_EVAL)만 false, 최종(CEO)은 true.
    const rememberFlags = handleConversationTurn.execute.mock.calls.map(
      (call) => call[0].shouldRemember,
    );
    expect(rememberFlags).toEqual([true, false, true]);
  });

  it('CEO 풀체인: PO_EVAL·IMPACT 선행을 당겨 3-hop 으로 성공한다', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make('7');
    // 호출 순서: CEO(실패) → PO_EVAL(실패) → IMPACT(성공) → PO_EVAL(성공) → CEO(성공)
    handleConversationTurn.execute
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

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(5);
    expect(handleConversationTurn.execute).toHaveBeenCalledWith(
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
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    handleConversationTurn.execute
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

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(3);
    expect(consoleEvents.publish).toHaveBeenCalledWith({
      type: 'command.rejected',
      commandId: 'c1',
      reason: 'CEO ← PO_EVAL: 순환 감지: PO_EVAL 재진입',
    });
  });

  it('NO_ASSIGNABLE_TASKS 는 재시도 없이 즉시 command.rejected', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new FakeDomainException(CtoErrorCode.INVALID_STUDY_VERDICT),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CTO' as never,
      commandId: 'c1',
    });

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(1);
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected', commandId: 'c1' }),
    );
  });

  it('선행 생성 실패(IMPACT env 없음)면 체인 경로와 함께 rejected, 상위 재시도 안 함', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make('7');
    handleConversationTurn.execute
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

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(3);
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
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
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
    handleConversationTurn.execute
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_CEO'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_PM'))
      .mockRejectedValueOnce(new FakeDomainException('CHAIN_CYCLE'));

    try {
      await orchestrator.run({
        slackUserId: 'U1',
        agentTypeHint: AgentType.CEO,
        commandId: 'c1',
      });

      expect(handleConversationTurn.execute).toHaveBeenCalledTimes(3);
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
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    const prereqWorkers: Record<string, AgentType> = {
      CHAIN_1: AgentType.PM,
      CHAIN_2: AgentType.CTO_STUDY,
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
    handleConversationTurn.execute
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

      expect(handleConversationTurn.execute).toHaveBeenCalledTimes(4);
      expect(consoleEvents.publish).toHaveBeenCalledWith({
        type: 'command.rejected',
        commandId: 'c1',
        reason: 'CEO ← PM ← CTO_STUDY ← PO_SHADOW: 자동 체이닝 깊이 초과',
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
      const { orchestrator, handleConversationTurn } = make(recentDays);
      handleConversationTurn.execute
        .mockRejectedValueOnce(
          new FakeDomainException(PoEvalErrorCode.NO_SUB_AGENT_RUNS),
        )
        .mockResolvedValueOnce(ok('IMPACT_REPORTER'))
        .mockResolvedValueOnce(ok('PO_EVAL'));

      await orchestrator.run({
        slackUserId: 'U1',
        agentTypeHint: AgentType.PO_EVAL,
      });

      expect(handleConversationTurn.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          agentTypeHint: AgentType.IMPACT_REPORTER,
          text: '--recent 7d',
        }),
      );
    },
  );

  it('commandId 없으면 SSE 를 발행하지 않는다', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new FakeDomainException(CtoErrorCode.INVALID_STUDY_VERDICT),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CTO' as never,
    });

    expect(consoleEvents.publish).not.toHaveBeenCalled();
  });

  it('매핑에 없는 도메인 예외는 원래 메시지로 rejected', async () => {
    const { orchestrator, handleConversationTurn, consoleEvents } = make();
    handleConversationTurn.execute.mockRejectedValue(
      new FakeDomainException('PARSE_FAILED'),
    );

    await orchestrator.run({
      slackUserId: 'U1',
      agentTypeHint: 'CEO' as never,
      commandId: 'c1',
    });

    expect(handleConversationTurn.execute).toHaveBeenCalledTimes(1);
    expect(consoleEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.rejected', commandId: 'c1' }),
    );
    expect(consoleEvents.publish).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'command.answered' }),
    );
  });
});
