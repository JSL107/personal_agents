import { DomainStatus } from '../../common/exception/domain-status.enum';
import { AgentType } from '../../model-router/domain/model-router.type';
import { formatNeedsDate } from '../../slack/format/schedule.formatter';
import { AnswerScheduleQuestionUsecase } from '../application/answer-schedule-question.usecase';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { ScheduleStatus } from '../domain/schedule.type';
import { ScheduleErrorCode } from '../domain/schedule-error-code.enum';
import { ScheduleDispatcher as ProductionScheduleDispatcher } from './schedule.dispatcher';

class ScheduleDispatcher extends ProductionScheduleDispatcher {
  constructor(
    registerSchedule: ConstructorParameters<
      typeof ProductionScheduleDispatcher
    >[0],
    answerQuestion: ConstructorParameters<
      typeof ProductionScheduleDispatcher
    >[1],
    agentRunService: ConstructorParameters<
      typeof ProductionScheduleDispatcher
    >[2],
    extractSchedule: ConstructorParameters<
      typeof ProductionScheduleDispatcher
    >[3],
    manageSchedule: ConstructorParameters<
      typeof ProductionScheduleDispatcher
    >[4] = { execute: jest.fn() } as never,
    repository: ConstructorParameters<
      typeof ProductionScheduleDispatcher
    >[5] = { findUnfinished: jest.fn().mockResolvedValue([]) } as never,
  ) {
    super(
      registerSchedule,
      answerQuestion,
      agentRunService,
      extractSchedule,
      manageSchedule,
      repository,
    );
  }
}

const createUsecase = (): RegisterScheduleUsecase => {
  return {
    execute: jest.fn().mockResolvedValue({
      id: 1,
      slackUserId: 'U1',
      title: '자동차세',
      dueDate: new Date('2026-09-30T00:00:00.000Z'),
      dueTime: null,
      linkUrl: null,
      memo: null,
      status: ScheduleStatus.OPEN,
      completedAt: null,
    }),
  } as unknown as RegisterScheduleUsecase;
};

const createAnswer = (): AnswerScheduleQuestionUsecase =>
  ({
    execute: jest.fn().mockResolvedValue({
      agentRunId: 61,
      modelUsed: 'codex-cli',
      result: {
        text: '9월 30일에 자동차세가 등록돼 있어요.',
        usedFallback: false,
      },
    }),
  }) as unknown as AnswerScheduleQuestionUsecase;

// execute 는 run 결과를 그대로 돌려준다 — 등록 회차의 원장 기록 여부는 호출 인자로 확인한다.
const createAgentRunService = () => ({
  execute: jest.fn(async ({ run }) => ({
    ...(await run({})),
    agentRunId: 42,
  })),
});

describe('ScheduleDispatcher', () => {
  it.each([
    '11월 10일 프로젝트 시작',
    '9월 30일 자동차세 메모: 카드 결제',
    '10월 5일 건강검진 3시에 알려줘',
  ])('제목 일치가 없으면 기존 등록 경로를 탄다: %s', async (text) => {
    const registerSchedule = createUsecase();
    const manage = { execute: jest.fn() };
    const repository = { findUnfinished: jest.fn().mockResolvedValue([]) };
    const dispatcher = Reflect.construct(ScheduleDispatcher, [
      registerSchedule,
      createAnswer(),
      createAgentRunService(),
      { execute: jest.fn() },
      manage,
      repository,
    ]) as ScheduleDispatcher;
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text,
    });
    expect(registerSchedule.execute).toHaveBeenCalledTimes(1);
    expect(manage.execute).not.toHaveBeenCalled();
  });

  it('제목이 일치하면 알림 발화는 관리 경로로 간다', async () => {
    const item = {
      id: 17,
      slackUserId: 'U1',
      title: '결제 API',
      status: ScheduleStatus.OPEN,
      dueDate: null,
    };
    const manage = {
      execute: jest.fn().mockResolvedValue({
        agentRunId: 1,
        output: { action: 'REMIND' },
        modelUsed: 'codex-cli',
        formattedText: '알림을 걸었어요',
      }),
    };
    const repository = { findUnfinished: jest.fn().mockResolvedValue([item]) };
    const registerSchedule = createUsecase();
    const dispatcher = Reflect.construct(ScheduleDispatcher, [
      registerSchedule,
      createAnswer(),
      createAgentRunService(),
      { execute: jest.fn() },
      manage,
      repository,
    ]) as ScheduleDispatcher;
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 API 내일 3시에 알려줘',
    });
    expect(manage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ candidates: [item] }),
    );
    expect(registerSchedule.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['11월 10일 프로젝트 시작', '프로젝트'],
    ['9월 30일 자동차세 메모: 카드 결제', '자동차세'],
    ['10월 5일 건강검진 3시에 알려줘', '건강검진'],
  ])('제목이 일치할 때만 관리 경로로 간다: %s', async (text, title) => {
    const item = {
      id: 18,
      slackUserId: 'U1',
      title,
      status: ScheduleStatus.OPEN,
      dueDate: null,
    };
    const manage = {
      execute: jest.fn().mockResolvedValue({
        agentRunId: 1,
        output: {},
        modelUsed: 'codex-cli',
        formattedText: '관리했어요',
      }),
    };
    const repository = { findUnfinished: jest.fn().mockResolvedValue([item]) };
    const registerSchedule = createUsecase();
    const dispatcher = Reflect.construct(ScheduleDispatcher, [
      registerSchedule,
      createAnswer(),
      createAgentRunService(),
      { execute: jest.fn() },
      manage,
      repository,
    ]) as ScheduleDispatcher;
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text,
    });
    expect(repository.findUnfinished).toHaveBeenCalledWith({
      slackUserId: 'U1',
    });
    expect(manage.execute).toHaveBeenCalledWith(
      expect.objectContaining({ candidates: [item] }),
    );
    expect(registerSchedule.execute).not.toHaveBeenCalled();
  });

  it('제목이 겹쳐도 질문형이면 쓰지 않고 조회한다', async () => {
    const manage = { execute: jest.fn() };
    const answer = createAnswer();
    const repository = {
      findUnfinished: jest.fn().mockResolvedValue([
        {
          id: 19,
          slackUserId: 'U1',
          title: '결제 API',
          status: ScheduleStatus.OPEN,
        },
      ]),
    };
    const dispatcher = Reflect.construct(ScheduleDispatcher, [
      createUsecase(),
      answer,
      createAgentRunService(),
      { execute: jest.fn() },
      manage,
      repository,
    ]) as ScheduleDispatcher;
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '결제 API 끝났어?',
    });
    expect(answer.execute).toHaveBeenCalled();
    expect(manage.execute).not.toHaveBeenCalled();
  });
  it('agentType 은 SCHEDULE 이다', () => {
    expect(
      new ScheduleDispatcher(
        createUsecase(),
        createAnswer(),
        createAgentRunService() as never,
        { execute: jest.fn().mockResolvedValue(null) } as never,
      ).agentType,
    ).toBe(AgentType.SCHEDULE);
  });

  it('날짜와 제목이 있으면 등록하고 확인 문장을 낸다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일 자동차세',
    });

    expect(usecase.execute).toHaveBeenCalled();
    expect(outcome.formattedText).toContain('자동차세');
    expect(outcome.modelUsed).toBe('deterministic');
  });

  it('등록은 AgentRun 을 남기고, 되묻기는 남기지 않는다', async () => {
    const agentRunService = createAgentRunService();
    const dispatcher = new ScheduleDispatcher(
      createUsecase(),
      createAnswer(),
      agentRunService as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const registered = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일 자동차세',
    });
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '자동차세 등록해줘',
    });

    expect(agentRunService.execute).toHaveBeenCalledTimes(1);
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: AgentType.SCHEDULE,
        triggerType: 'SLACK_MENTION_SCHEDULE',
      }),
    );
    expect(registered.agentRunId).toBe(42);
    // episodic 인덱스에 계측(id)만 쌓이지 않게 제목·마감일을 output 에 싣는다.
    const { run } = agentRunService.execute.mock.calls[0][0];
    await expect(run({})).resolves.toMatchObject({
      output: { scheduleId: 1, title: '자동차세' },
    });
  });

  it.each([undefined, '', '   '])(
    '문장 없이(%p) 불리면 되묻기 답 대신 BAD_REQUEST 를 던진다 — 콘솔이 입력 요청으로 잇는다',
    async (text) => {
      const usecase = createUsecase();
      const answer = createAnswer();
      const dispatcher = new ScheduleDispatcher(
        usecase,
        answer,
        createAgentRunService() as never,
        { execute: jest.fn().mockResolvedValue(null) } as never,
      );

      await expect(
        dispatcher.dispatch({
          source: 'REMOTE_CONSOLE',
          slackUserId: 'U1',
          text,
        }),
      ).rejects.toMatchObject({
        errorCode: ScheduleErrorCode.INPUT_REQUIRED,
        status: DomainStatus.BAD_REQUEST,
      });
      expect(usecase.execute).not.toHaveBeenCalled();
      expect(answer.execute).not.toHaveBeenCalled();
    },
  );

  it('날짜가 없으면 등록하지 않고 되묻는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '자동차세 등록해줘',
    });

    expect(usecase.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('언제');
  });

  it('되묻기 후속으로 날짜만 오면 직전 SCHEDULE 턴의 제목과 합쳐 등록한다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일',
      priorTurns: [
        {
          role: 'user',
          text: '자동차세 등록해줘',
          agentType: AgentType.SCHEDULE,
          agentRunId: null,
          timestampMs: 1,
        },
      ],
    });

    expect(usecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: '자동차세' }),
    );
    expect(outcome.formattedText).toContain('자동차세');
  });

  it('직전 턴이 다른 워커면 합치지 않는다 — 남의 대화를 제목으로 끌어오지 않는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일',
      priorTurns: [
        {
          role: 'user',
          text: '오늘 뭐해?',
          agentType: AgentType.PM,
          agentRunId: null,
          timestampMs: 1,
        },
      ],
    });

    expect(usecase.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText.length).toBeGreaterThan(0);
  });

  it('봇이 한 되묻기 발화는 제목으로 쓰지 않는다 — assistant 턴은 사용자의 말이 아니다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일',
      priorTurns: [
        {
          role: 'assistant',
          text: '언제까지인지 알려주세요',
          agentType: AgentType.SCHEDULE,
          agentRunId: null,
          timestampMs: 1,
        },
      ],
    });

    expect(usecase.execute).not.toHaveBeenCalled();
  });

  it('날짜와 제목이 있어도 원문이 질문이면 등록하지 않는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일 자동차세 맞아?',
    });

    expect(usecase.execute).not.toHaveBeenCalled();
    // 등록은 하지 않되, 등록된 일정으로 질문에 답한다.
    expect(answer.execute).toHaveBeenCalledWith(
      expect.objectContaining({ text: '9월 30일 자동차세 맞아?' }),
    );
    expect(outcome.formattedText).toContain(
      '9월 30일에 자동차세가 등록돼 있어요.',
    );
    expect(outcome.output).toMatchObject({
      heldWrite: { action: 'REGISTER' },
    });
    expect(outcome.formattedText).toContain('질문으로 보여서');
  });

  it('직전 턴과 합쳐 REGISTER 가 되어도 이번 원문이 질문이면 등록하지 않는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일이라면 며칠 남았어',
      priorTurns: [
        {
          role: 'user',
          text: '자동차세 등록해줘',
          agentType: AgentType.SCHEDULE,
          agentRunId: 0,
          timestampMs: Date.now(),
        },
      ],
    });

    expect(usecase.execute).not.toHaveBeenCalled();
    expect(outcome.formattedText).toContain('질문으로 보여서');
  });

  it('날짜 없는 질문이 되묻기로 빠진 뒤 날짜만 오면, 합친 직전 턴이 질문이라 등록하지 않는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const first = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '자동차세 등록해도 돼?',
    });
    const second = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일',
      priorTurns: [
        {
          role: 'user',
          text: '자동차세 등록해도 돼?',
          agentType: AgentType.SCHEDULE,
          agentRunId: 0,
          timestampMs: Date.now(),
        },
      ],
    });

    expect(usecase.execute).not.toHaveBeenCalled();
    expect(first.formattedText).toContain('질문으로 보여서');
    expect(second.formattedText).toContain('질문으로 보여서');
  });

  it.each(['이번주 일정 알려줘', '오늘 할 일'])(
    '조회 문장 "%s" 는 등록하거나 날짜를 되묻지 않고 등록된 일정으로 답한다',
    async (text) => {
      const usecase = createUsecase();
      const answer = createAnswer();
      const dispatcher = new ScheduleDispatcher(
        usecase,
        answer,
        createAgentRunService() as never,
        { execute: jest.fn().mockResolvedValue(null) } as never,
      );

      const outcome = await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text,
      });

      expect(usecase.execute).not.toHaveBeenCalled();
      expect(answer.execute).toHaveBeenCalledWith(
        expect.objectContaining({ text, parsedIntent: { kind: 'LOOKUP' } }),
      );
      expect(outcome.formattedText).toBe(
        '9월 30일에 자동차세가 등록돼 있어요.',
      );
      expect(outcome.formattedText).not.toContain('언제까지');
    },
  );

  it('직전 턴이 조회 질문이면 날짜만 온 다음 턴과 합쳐 등록하지 않는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일',
      priorTurns: [
        {
          role: 'user',
          text: '이번주 일정 알려줘',
          agentType: AgentType.SCHEDULE,
          agentRunId: 0,
          timestampMs: Date.now(),
        },
      ],
    });

    expect(usecase.execute).not.toHaveBeenCalled();
    // 제목이 없으니 무엇을 등록할지 되묻는다(조회 문장을 제목으로 쓰지 않는다).
    expect(outcome.formattedText).toContain('무엇을 등록할까요');
  });

  it('가장 가까운 일정 턴이 조회면, 그 전의 미완료 등록 턴과도 합치지 않는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(
      usecase,
      answer,
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );
    const turn = (text: string) => ({
      role: 'user' as const,
      text,
      agentType: AgentType.SCHEDULE,
      agentRunId: 0,
      timestampMs: Date.now(),
    });

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일',
      priorTurns: [turn('자동차세 등록해줘'), turn('이번주 일정 알려줘')],
    });

    // "자동차세" 가 9월 30일로 등록되면 안 된다 — 조회 질문이 그 등록 흐름을 끊었다.
    expect(usecase.execute).not.toHaveBeenCalled();
  });
});

describe('직전 대화 일정 등록', () => {
  const priorTurns = [
    {
      role: 'assistant' as const,
      text: '원인은 설정입니다',
      agentType: null,
      agentRunId: null,
      timestampMs: 1,
    },
  ];
  // 2026-11-03 실행 #11278: 지시어("그럼")만 있는 질문이 모델 추출을 거쳐 "11월 남은 일정 파악" 으로 등록됐다.
  it.each([
    '그럼 이중에 남은일정을 파악해볼래',
    '그럼 그거 어떻게 생각해?',
    '그러면 이걸로 진행하자',
  ])(
    '쓰기 동사 없는 참조 문장 "%s" 는 대화에서 일정을 뽑아 등록하지 않고 등록된 일정으로 답한다',
    async (text) => {
      const register = createUsecase();
      const answer = createAnswer();
      const extract = { execute: jest.fn() };
      const dispatcher = new ScheduleDispatcher(
        register,
        answer,
        createAgentRunService() as never,
        extract as never,
      );

      await dispatcher.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId: 'U1',
        text,
        priorTurns,
      });

      expect(extract.execute).not.toHaveBeenCalled();
      expect(register.execute).not.toHaveBeenCalled();
      expect(answer.execute).toHaveBeenCalled();
    },
  );

  it('쓰기 동사가 없어도 날짜를 준 참조("그럼 9월 30일")는 되묻기 후속이라 대화에서 뽑아 등록한다', async () => {
    const register = createUsecase();
    const answer = createAnswer();
    const extract = {
      execute: jest.fn().mockResolvedValue({
        title: '자동차세',
        dueDate: { year: 2026, month: 9, day: 30 },
        memo: '',
        modelUsed: 'model',
      }),
    };
    const dispatcher = new ScheduleDispatcher(
      register,
      answer,
      createAgentRunService() as never,
      extract as never,
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '그럼 9월 30일',
      priorTurns,
    });

    expect(extract.execute).toHaveBeenCalled();
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: '자동차세' }),
    );
    expect(answer.execute).not.toHaveBeenCalled();
  });

  // #957 리뷰: 제목 되묻기에 "원인 분석" 으로 답하면 "원인" 이 참조로 잡히지만, 직전 요청과 합쳐 등록이 완성된다.
  it('제목 되묻기의 후속 답은 쓰기 동사가 없어도 조회로 바꾸지 않고 등록한다', async () => {
    const register = createUsecase();
    const answer = createAnswer();
    const extract = {
      execute: jest.fn().mockResolvedValue({
        title: '원인 분석',
        dueDate: { year: 2026, month: 11, day: 4 },
        memo: '',
        modelUsed: 'model',
      }),
    };
    const dispatcher = new ScheduleDispatcher(
      register,
      answer,
      createAgentRunService() as never,
      extract as never,
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '원인 분석',
      priorTurns: [
        {
          role: 'user' as const,
          text: '내일 일정 등록해줘',
          agentType: AgentType.SCHEDULE,
          agentRunId: null,
          timestampMs: 1,
        },
        {
          role: 'assistant' as const,
          text: '어떤 일정인지 제목을 알려 주세요.',
          agentType: AgentType.SCHEDULE,
          agentRunId: null,
          timestampMs: 2,
        },
      ],
    });

    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: '원인 분석' }),
    );
    expect(answer.execute).not.toHaveBeenCalled();
  });

  // #957 이대리 리뷰: 제목 되묻기 중이면 질문도 직전 요청과 합쳐 REGISTER 가 된다. 조회 동사가 있는
  // 질문은 그 병합보다 먼저 조회로 걸러져야 한다.
  it('제목 되묻기 중에 온 조회 질문은 직전 요청과 합치지 않고 답한다', async () => {
    const register = createUsecase();
    const answer = createAnswer();
    const extract = { execute: jest.fn() };
    const dispatcher = new ScheduleDispatcher(
      register,
      answer,
      createAgentRunService() as never,
      extract as never,
    );

    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '그럼 이중에 남은일정을 파악해볼래',
      priorTurns: [
        {
          role: 'user' as const,
          text: '내일 일정 등록해줘',
          agentType: AgentType.SCHEDULE,
          agentRunId: null,
          timestampMs: 1,
        },
        {
          role: 'assistant' as const,
          text: '어떤 일정인지 제목을 알려 주세요.',
          agentType: AgentType.SCHEDULE,
          agentRunId: null,
          timestampMs: 2,
        },
      ],
    });

    expect(extract.execute).not.toHaveBeenCalled();
    expect(register.execute).not.toHaveBeenCalled();
    expect(answer.execute).toHaveBeenCalled();
  });

  it('원인 참조를 추출해 메모와 오늘 날짜로 등록하고 모델 원장을 남긴다', async () => {
    const register = createUsecase();
    const agentRunService = createAgentRunService();
    const extract = {
      execute: jest.fn().mockResolvedValue({
        title: '설정 수정',
        dueDate: null,
        memo: '<https://x|y>',
        modelUsed: 'model',
      }),
    };
    const dispatcher = new ScheduleDispatcher(
      register,
      createAnswer(),
      agentRunService as never,
      extract as never,
    );
    const result = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '원인과 함께 일정에 등록해줄래?',
      priorTurns,
    });
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({ title: '설정 수정', memo: '<https://x|y>' }),
    );
    expect(result.modelUsed).toBe('model');
    expect(result.formattedText).toContain('오늘로 등록');
    expect(result.formattedText).toContain('&lt;https://x|y&gt;');
    expect(agentRunService.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        inputSnapshot: expect.objectContaining({
          source: 'CONVERSATION',
          hasMemo: true,
        }),
      }),
    );
  });
  it('직전 대화를 가리키지 않는 평범한 요청은 모델 추출 없이 날짜를 되묻는다', async () => {
    const register = createUsecase();
    // 앞 대화의 무관한 날짜를 집어 와도 쓰이지 않아야 한다.
    const extract = {
      execute: jest.fn().mockResolvedValue({
        title: '자동차세',
        dueDate: { year: 2026, month: 10, day: 31 },
        memo: '',
        modelUsed: 'model',
      }),
    };
    const dispatcher = new ScheduleDispatcher(
      register,
      createAnswer(),
      createAgentRunService() as never,
      extract as never,
    );
    const result = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '자동차세 등록해줘',
      priorTurns,
    });
    expect(extract.execute).not.toHaveBeenCalled();
    expect(register.execute).not.toHaveBeenCalled();
    expect(result.formattedText).toBe(formatNeedsDate('자동차세'));
  });
  it('완전한 파서 결과가 있어도 참조 추출 실패 시 등록하지 않는다', async () => {
    const register = createUsecase();
    const extract = { execute: jest.fn().mockResolvedValue(null) };
    const dispatcher = new ScheduleDispatcher(
      register,
      createAnswer(),
      createAgentRunService() as never,
      extract as never,
    );
    const result = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '내일 원인과 함께 등록해줘',
      priorTurns,
    });
    expect(extract.execute).toHaveBeenCalled();
    expect(register.execute).not.toHaveBeenCalled();
    expect(result.formattedText).toContain('제목을 알려');
  });
  it('assistant 가 없거나 가정형이면 추출하지 않는다', async () => {
    const extract = { execute: jest.fn() };
    const dispatcher = new ScheduleDispatcher(
      createUsecase(),
      createAnswer(),
      createAgentRunService() as never,
      extract as never,
    );
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '원인과 함께 등록해줘',
    });
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '원인과 함께 등록해도 돼?',
      priorTurns,
    });
    expect(extract.execute).not.toHaveBeenCalled();
  });
  it('날짜가 있는 참조 요청도 모델 추출 결과를 등록한다', async () => {
    const register = createUsecase();
    const extract = {
      execute: jest.fn().mockResolvedValue({
        title: '원인 수정',
        dueDate: { year: 2026, month: 10, day: 31 },
        memo: '설정',
        modelUsed: 'model',
      }),
    };
    const dispatcher = new ScheduleDispatcher(
      register,
      createAnswer(),
      createAgentRunService() as never,
      extract as never,
    );
    await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '내일 원인과 함께 등록해줘',
      priorTurns,
    });
    expect(register.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '원인 수정',
        dueDate: { year: 2026, month: 10, day: 31 },
      }),
    );
  });
  it('참조가 아닌 요청의 추출이 실패하면 기존 날짜 되묻기를 유지한다', async () => {
    const dispatcher = new ScheduleDispatcher(
      createUsecase(),
      createAnswer(),
      createAgentRunService() as never,
      { execute: jest.fn().mockResolvedValue(null) } as never,
    );
    const result = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '자동차세 등록해줘',
      priorTurns,
    });
    expect(result.formattedText).toContain('언제');
  });
});
