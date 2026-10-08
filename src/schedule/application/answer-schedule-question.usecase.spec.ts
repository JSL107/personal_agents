import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { FactAnswerUsecase } from '../../fact-answer/application/fact-answer.usecase';
import { ScheduleStatus } from '../domain/schedule.type';
import { AnswerScheduleQuestionUsecase } from './answer-schedule-question.usecase';
import { ListSchedulesUsecase } from './list-schedules.usecase';

const item = (title: string, iso: string, isHoliday = false) => ({
  id: 1,
  slackUserId: 'U1',
  title,
  dueDate: new Date(`${iso}T00:00:00.000Z`),
  dueTime: null,
  linkUrl: null,
  memo: null,
  status: ScheduleStatus.OPEN,
  completedAt: null,
  isHoliday,
});

describe('AnswerScheduleQuestionUsecase', () => {
  it('등록된 일정(공휴일 제외)을 사실로 넘기고 UNKNOWN 회차로 원장에 남긴다', async () => {
    const listExecute = jest
      .fn()
      .mockResolvedValue([
        item('자동차세', '2026-10-30'),
        item('개천절', '2026-10-03', true),
      ]);
    const execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 71 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 71 };
    });
    const answer = jest
      .fn()
      .mockResolvedValue({ text: '답', usedFallback: false, modelUsed: 'm' });
    const usecase = new AnswerScheduleQuestionUsecase(
      { execute: listExecute } as unknown as ListSchedulesUsecase,
      { execute } as unknown as AgentRunService,
      { answer } as unknown as FactAnswerUsecase,
    );

    await usecase.execute({
      slackUserId: 'U1',
      // KST 기준일. UTC 로는 전날(10-06 18:00Z)이어도 사실의 오늘은 10-07 이어야 한다.
      today: { year: 2026, month: 10, day: 7 },
      text: '이번 달 일정 뭐 있어?',
      priorTurns: [],
      parsedIntent: { kind: 'NEEDS_TITLE' },
    });

    expect(execute.mock.calls[0][0]).toMatchObject({
      triggerType: 'SLACK_MENTION_SCHEDULE',
      inputSnapshot: { action: 'UNKNOWN' },
    });
    const { from, to } = listExecute.mock.calls[0][0];
    // 시각 없는 UTC 자정 — 경계일 일정이 gte·lte 비교에서 빠지지 않는다.
    expect(from.toISOString()).toBe('2026-09-23T00:00:00.000Z');
    expect(to.toISOString()).toBe('2027-10-08T00:00:00.000Z');
    expect(answer.mock.calls[0][0].facts.today).toBe('2026-10-07');
    expect(answer.mock.calls[0][0].facts.schedules).toEqual([
      {
        title: '자동차세',
        due: '2026-10-30',
        dueTime: null,
        status: ScheduleStatus.OPEN,
      },
    ]);
  });
});
