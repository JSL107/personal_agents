import { AgentType } from '../../model-router/domain/model-router.type';
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

describe('ScheduleDispatcher', () => {
  it('agentType 은 SCHEDULE 이다', () => {
    expect(new ScheduleDispatcher(createUsecase()).agentType).toBe(
      AgentType.SCHEDULE,
    );
  });

  it('날짜와 제목이 있으면 등록하고 확인 문장을 낸다', async () => {
    const usecase = createUsecase();
    const dispatcher = new ScheduleDispatcher(usecase);

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
    const dispatcher = new ScheduleDispatcher(usecase);

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
    const dispatcher = new ScheduleDispatcher(usecase);

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
    const dispatcher = new ScheduleDispatcher(usecase);

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
    const dispatcher = new ScheduleDispatcher(usecase);

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
});
