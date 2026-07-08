import { DailyPlan, TaskItem } from '../pm-agent.type';
import { createRecentPlanSummary } from './recent-plan-summary-formatter';

const task = (
  id: string,
  title: string,
  overrides: Partial<TaskItem> = {},
) => ({
  id,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
});

describe('createRecentPlanSummary', () => {
  it('topPriority + morning + afternoon 의 TaskItem.id 를 taskIds 로 수집한다', () => {
    const plan: DailyPlan = {
      topPriority: task('top-id', 'top'),
      varianceAnalysis: {
        rolledOverTasks: [],
        analysisReasoning: '(이월 없음)',
      },
      morning: [task('morning-id', 'morning')],
      afternoon: [task('', 'legacy-empty'), task('afternoon-id', 'afternoon')],
      blocker: null,
      estimatedHours: 5,
      reasoning: 'r',
    };

    const result = createRecentPlanSummary(
      plan,
      new Date('2026-07-07T01:00:00Z'),
      10,
    );

    expect(result.taskIds).toEqual(['top-id', 'morning-id', 'afternoon-id']);
  });
});
