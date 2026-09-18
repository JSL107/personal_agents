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
});
