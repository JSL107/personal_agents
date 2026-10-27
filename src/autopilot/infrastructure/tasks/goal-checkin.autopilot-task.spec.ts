import { GoalCheckinAutopilotTask } from './goal-checkin.autopilot-task';

const makeRepositories = () => ({
  goals: { findActive: jest.fn().mockResolvedValue([]) },
  questions: {
    findOpen: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(undefined),
  },
});

describe('GoalCheckinAutopilotTask', () => {
  const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-10-27' };

  it('활성 목표가 있으면 질문하지 않는다', async () => {
    const { goals, questions } = makeRepositories();
    goals.findActive.mockResolvedValue([{ id: 1 }]);
    const task = new GoalCheckinAutopilotTask(
      goals as never,
      questions as never,
    );

    expect(await task.run(context)).toEqual({ skip: true });
    expect(questions.findOpen).not.toHaveBeenCalled();
  });

  it('열린 질문이 있으면 중복 질문하지 않는다', async () => {
    const { goals, questions } = makeRepositories();
    questions.findOpen.mockResolvedValue({ id: 1 });
    const task = new GoalCheckinAutopilotTask(
      goals as never,
      questions as never,
    );

    expect(await task.run(context)).toEqual({ skip: true });
    expect(questions.create).not.toHaveBeenCalled();
  });

  it('질문 발송 후에만 72시간 표지를 만든다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T00:15:00.000Z'));
    try {
      const { goals, questions } = makeRepositories();
      const task = new GoalCheckinAutopilotTask(
        goals as never,
        questions as never,
      );

      const result = await task.run(context);
      expect(result.skip).toBe(false);
      expect(result.summaryText).toContain('요즘 머릿속에 있는 목표');
      expect(result.emptyReason).toBeUndefined();
      expect(questions.create).not.toHaveBeenCalled();

      await result.onDelivered?.();
      expect(questions.create).toHaveBeenCalledWith({
        slackUserId: 'U1',
        expiresAt: new Date('2026-10-30T00:15:00.000Z'),
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
