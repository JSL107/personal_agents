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
  // 메인은 「오늘 무엇을 하나」 로 시작한다. 전에는 판단 근거가 최상단이라, 아직 할 일을 모르는
  // 상태에서 근거부터 읽어야 했다(실측: 메인 2,024자 중 앞 4줄 330자가 근거, 할 일은 6행부터).
  it('메인은 판단 근거가 아니라 오늘 할 일로 시작한다', () => {
    const result = formatDailyPlan(plan());

    expect(result.summary.startsWith('*오늘의 최우선 과제*')).toBe(true);
    expect(result.summary).not.toContain('*판단 근거*');
  });

  it('판단 근거는 스레드로 내린다', () => {
    const result = formatDailyPlan(plan());

    expect(result.detail).toContain('*판단 근거*');
    expect(result.detail).toContain('GitHub와 전일 plan을 기준으로 재배치');
  });

  // 오늘 하지 않는 것이 하는 것보다 길어지면 안 된다(실측: 과제 3건 대 이월 11줄).
  it('어제 이월은 스레드로 내리고 메인에는 건수만 알린다', () => {
    const result = formatDailyPlan(
      plan({
        varianceAnalysis: {
          rolledOverTasks: ['이월 A', '이월 B'],
          analysisReasoning: '실적 근거 없음으로 판정',
        },
      }),
    );

    expect(result.summary).not.toContain('이월 A');
    expect(result.summary).toContain('어제 이월 2건');
    expect(result.detail).toContain('*어제 이월*');
    expect(result.detail).toContain('• 이월 A');
    expect(result.detail).toContain('_이월 근거_: 실적 근거 없음으로 판정');
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
    expect(result.summary).toContain('정체 항목 1건');
  });

  it('스레드로 내릴 것이 없으면 detail 과 안내를 모두 비운다', () => {
    const result = formatDailyPlan(
      plan({
        reasoning: '',
        varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
      }),
    );

    expect(result.detail).toBe('');
    expect(result.summary).not.toContain('👇 스레드:');
  });

  // 과제 줄의 링크는 이번 재배치와 무관하게 유지된다 — PR·Issue 로 바로 이동하는 경로다.
  it('과제 줄의 링크를 유지한다', () => {
    const result = formatDailyPlan(
      plan({
        topPriority: task('최우선 PR', {
          url: 'https://github.com/repo/app/pull/7',
        }),
      }),
    );

    expect(result.summary).toContain(
      '<https://github.com/repo/app/pull/7|최우선 PR>',
    );
  });
});
