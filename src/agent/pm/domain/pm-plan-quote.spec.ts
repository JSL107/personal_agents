import { DailyPlan, TaskItem } from './pm-agent.type';
import { formatPmPlanQuote } from './pm-plan-quote';

const task = (title: string): TaskItem => ({
  id: `user:${title}`,
  title,
  source: 'USER_INPUT',
  subtasks: [],
  isCriticalPath: false,
});

const plan = (topPriority: string, morning: string[]): DailyPlan => ({
  topPriority: task(topPriority),
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
  morning: morning.map(task),
  afternoon: [],
  blocker: null,
  estimatedHours: 4,
  reasoning: 'r',
});

describe('formatPmPlanQuote', () => {
  it('최우선과 오전 항목 제목을 중복 없이 최대 3개 잇는다', () => {
    expect(formatPmPlanQuote(plan('A', ['A', 'B', 'C', 'D']))).toBe(
      'A / B / C',
    );
  });

  it('제목이 하나도 없으면 undefined', () => {
    expect(formatPmPlanQuote(plan('  ', []))).toBeUndefined();
  });

  it('계획 모양이 아니면 인용을 내지 않는다', () => {
    expect(formatPmPlanQuote(undefined)).toBeUndefined();
    expect(formatPmPlanQuote({ topPriority: { title: 'A' } })).toBeUndefined();
  });
});
