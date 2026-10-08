import { AgentType } from '../../model-router/domain/model-router.type';
import { AnswerScheduleQuestionUsecase } from '../application/answer-schedule-question.usecase';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { ScheduleStatus } from '../domain/schedule.type';
import { ScheduleDispatcher } from './schedule.dispatcher';

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

describe('ScheduleDispatcher', () => {
  it('agentType 은 SCHEDULE 이다', () => {
    expect(
      new ScheduleDispatcher(createUsecase(), createAnswer()).agentType,
    ).toBe(AgentType.SCHEDULE);
  });

  it('날짜와 제목이 있으면 등록하고 확인 문장을 낸다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(usecase, answer);

    const outcome = await dispatcher.dispatch({
      source: 'SLACK_MESSAGE',
      slackUserId: 'U1',
      text: '9월 30일 자동차세',
    });

    expect(usecase.execute).toHaveBeenCalled();
    expect(outcome.formattedText).toContain('자동차세');
    expect(outcome.modelUsed).toBe('deterministic');
  });

  it('날짜가 없으면 등록하지 않고 되묻는다', async () => {
    const usecase = createUsecase();
    const answer = createAnswer();
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
      const dispatcher = new ScheduleDispatcher(usecase, answer);

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
    const dispatcher = new ScheduleDispatcher(usecase, answer);

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
});
