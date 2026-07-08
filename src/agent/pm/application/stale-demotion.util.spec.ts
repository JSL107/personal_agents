import { DailyPlan, TaskItem } from '../domain/pm-agent.type';
import { applyStaleDemotion } from './stale-demotion.util';

const task = (
  id: string,
  title: string,
  overrides: Partial<TaskItem> = {},
) => ({
  id,
  title,
  source: overrides.source ?? 'GITHUB',
  subtasks: overrides.subtasks ?? [],
  isCriticalPath: overrides.isCriticalPath ?? false,
  lineage: overrides.lineage,
  url: overrides.url,
});

const plan = (overrides: Partial<DailyPlan> = {}): DailyPlan => ({
  topPriority: task('repo/app#1', 'stale top', { isCriticalPath: true }),
  varianceAnalysis: {
    rolledOverTasks: [],
    analysisReasoning: '(이월 없음)',
  },
  morning: [task('repo/app#2', 'fresh morning')],
  afternoon: [task('repo/app#3', 'fresh afternoon')],
  blocker: null,
  estimatedHours: 6,
  reasoning: 'r',
  ...overrides,
});

describe('applyStaleDemotion', () => {
  it('stale id 를 topPriority/morning/afternoon 에서 제거하고 stalledTasks 로 이동한다', () => {
    const result = applyStaleDemotion({
      plan: plan({
        morning: [
          task('repo/app#2', 'fresh morning'),
          task('repo/app#4', 'stale morning', {
            url: 'https://github.com/repo/app/issues/4',
          }),
        ],
      }),
      staleIds: new Set(['repo/app#1', 'repo/app#4']),
      daysById: new Map([
        ['repo/app#1', 4],
        ['repo/app#4', 4],
      ]),
    });

    expect(result.topPriority.id).toBe('repo/app#2');
    expect(result.morning.map((item) => item.id)).toEqual([]);
    expect(result.afternoon.map((item) => item.id)).toEqual(['repo/app#3']);
    expect(result.stalledTasks).toEqual([
      {
        id: 'repo/app#1',
        title: 'stale top',
        daysStalled: 5,
        url: undefined,
      },
      {
        id: 'repo/app#4',
        title: 'stale morning',
        daysStalled: 5,
        url: 'https://github.com/repo/app/issues/4',
      },
    ]);
  });

  it('topPriority 가 stale 이면 첫 non-stale morning 을 승격한다', () => {
    const result = applyStaleDemotion({
      plan: plan(),
      staleIds: new Set(['repo/app#1']),
      daysById: new Map([['repo/app#1', 4]]),
    });

    expect(result.topPriority.id).toBe('repo/app#2');
    expect(result.morning).toEqual([]);
  });

  it('morning 에 non-stale 후보가 없으면 첫 non-stale afternoon 을 승격한다', () => {
    const result = applyStaleDemotion({
      plan: plan({
        morning: [task('repo/app#2', 'stale morning')],
      }),
      staleIds: new Set(['repo/app#1', 'repo/app#2']),
      daysById: new Map([
        ['repo/app#1', 4],
        ['repo/app#2', 4],
      ]),
    });

    expect(result.topPriority.id).toBe('repo/app#3');
    expect(result.afternoon).toEqual([]);
  });

  it('모든 항목이 stale 이면 결정 필요 fallback topPriority 를 만든다', () => {
    const result = applyStaleDemotion({
      plan: plan({
        morning: [],
        afternoon: [],
      }),
      staleIds: new Set(['repo/app#1']),
      daysById: new Map([['repo/app#1', 4]]),
    });

    expect(result.topPriority).toMatchObject({
      id: 'stalled-review',
      title: '정체 항목 종결/위임/보류 결정',
      source: 'USER_INPUT',
      isCriticalPath: true,
    });
    expect(result.morning).toEqual([]);
    expect(result.afternoon).toEqual([]);
  });

  it('LLM 이 이미 stalledTasks 에 넣은 항목과 dedup 병합한다', () => {
    const result = applyStaleDemotion({
      plan: plan({
        stalledTasks: [
          {
            id: 'repo/app#1',
            title: 'old title',
            daysStalled: 3,
            url: 'https://old.example.com',
          },
        ],
      }),
      staleIds: new Set(['repo/app#1']),
      daysById: new Map([['repo/app#1', 4]]),
    });

    expect(result.stalledTasks).toEqual([
      {
        id: 'repo/app#1',
        title: 'stale top',
        daysStalled: 5,
        url: undefined,
      },
    ]);
  });
});
