import { DailyPlan, TaskItem } from '../../agent/pm/domain/pm-agent.type';
import { formatDailyPlan } from './daily-plan.formatter';

const task = (title: string, overrides: Partial<TaskItem> = {}): TaskItem => ({
  id: overrides.id ?? `user:${title}`,
  title,
  source: overrides.source ?? 'USER_INPUT',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
  url: overrides.url,
});

const plan = (overrides: Partial<DailyPlan> = {}): DailyPlan => ({
  topPriority: task('최우선', { isCriticalPath: true }),
  varianceAnalysis: {
    rolledOverTasks: [],
    analysisReasoning: '(이월 없음)',
  },
  morning: [task('오전')],
  afternoon: [task('오후')],
  blocker: null,
  estimatedHours: 6,
  reasoning: 'GitHub와 전일 plan을 기준으로 재배치',
  ...overrides,
});

describe('formatDailyPlan', () => {
  it('판단 근거를 summary 최상단에 배치한다', () => {
    const result = formatDailyPlan(plan());

    expect(result.summary.startsWith('*판단 근거*: GitHub와 전일 plan')).toBe(
      true,
    );
    expect(result.summary).toContain('*오늘의 최우선 과제*');
  });

  it('stalledTasks 는 detail 에 결정 필요 섹션으로 렌더한다', () => {
    const result = formatDailyPlan(
      plan({
        stalledTasks: [
          {
            id: 'repo/app#1',
            title: '오래된 PR',
            daysStalled: 5,
            url: 'https://github.com/repo/app/pull/1',
          },
        ],
      }),
    );

    expect(result.detail).toContain('*정체 항목 (결정 필요)*');
    expect(result.detail).toContain(
      '<https://github.com/repo/app/pull/1|오래된 PR> (5일째) — 종결/위임/보류',
    );
    expect(result.detail).not.toContain('*판단 근거*');
  });

  it('stalledTasks 가 없으면 detail 을 비운다', () => {
    const result = formatDailyPlan(plan());

    expect(result.detail).toBe('');
  });
});
