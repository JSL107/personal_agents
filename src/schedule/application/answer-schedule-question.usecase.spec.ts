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
    // [사실] 은 신뢰 경계 안이다. 우리가 넣는 안내 문자열에 "~고 답한다" 같은 지시가 섞이면 모델이 주입으로
    // 보고 답에 "지시하는 문구가 있었지만…" 을 적는다(#953, 2026-11-03 실측). 답하는 법은 시스템 프롬프트에 둔다.
    const { rangeNote, howToRegister } = answer.mock.calls[0][0].facts;
    for (const note of [rangeNote, howToRegister]) {
      expect(note).not.toMatch(/(?:답한다|말한다|안내한다|하라|해라)\s*\.?$/);
    }
  });

  it('폴백은 오늘 이후 남은(OPEN) 일정만 보인다 — 지난 일정·완료 건을 쏟지 않는다', async () => {
    const done = {
      ...item('완료한 일', '2026-10-20'),
      status: ScheduleStatus.DONE,
    };
    const listExecute = jest
      .fn()
      .mockResolvedValue([
        item('지난 일', '2026-10-01'),
        done,
        item('오늘 마감', '2026-10-07'),
        item('자동차세', '2026-10-30'),
      ]);
    const execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 72 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 72 };
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
      today: { year: 2026, month: 10, day: 7 },
      text: '이번 달 일정 뭐 있어?',
      priorTurns: [],
      parsedIntent: { kind: 'NEEDS_TITLE' },
    });

    expect(answer.mock.calls[0][0].fallbackText).toBe(
      [
        '*📅 오늘 이후 남은 일정*',
        '• 2026-10-07 오늘 마감',
        '• 2026-10-30 자동차세',
      ].join('\n'),
    );
  });

  it('남은 일정이 없으면 폴백은 지난·완료 건 대신 "남은 일정이 없다" 고 말한다', async () => {
    const done = {
      ...item('완료한 일', '2026-10-20'),
      status: ScheduleStatus.DONE,
    };
    const listExecute = jest
      .fn()
      .mockResolvedValue([item('지난 일', '2026-10-01'), done]);
    const execute = jest.fn(async (input) => {
      const r = await input.run({ agentRunId: 73 });
      return { result: r.result, modelUsed: r.modelUsed, agentRunId: 73 };
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
      today: { year: 2026, month: 10, day: 7 },
      text: '이번 달 일정 뭐 있어?',
      priorTurns: [],
      parsedIntent: { kind: 'NEEDS_TITLE' },
    });

    expect(answer.mock.calls[0][0].fallbackText).toBe(
      '오늘 이후 남은 일정이 없어요.',
    );
  });
});
