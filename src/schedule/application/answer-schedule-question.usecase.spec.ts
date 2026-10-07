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
      now: new Date('2026-10-07T03:00:00.000Z'),
      text: '이번 달 일정 뭐 있어?',
      priorTurns: [],
      parsedIntent: { kind: 'NEEDS_TITLE' },
    });

    expect(execute.mock.calls[0][0]).toMatchObject({
      triggerType: 'SLACK_MENTION_SCHEDULE',
      inputSnapshot: { action: 'UNKNOWN' },
    });
    const { from, to } = listExecute.mock.calls[0][0];
    expect(from.toISOString().slice(0, 10)).toBe('2026-09-23');
    expect(to.toISOString().slice(0, 10)).toBe('2026-12-06');
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
