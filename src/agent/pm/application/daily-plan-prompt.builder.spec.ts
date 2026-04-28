import { DailyReview } from '../../work-reviewer/domain/work-reviewer.type';
import { DailyPlan, TaskItem } from '../domain/pm-agent.type';
import { RecentPlanSummary } from '../domain/prompt/recent-plan-summary-formatter';
import { DailyPlanContext } from './daily-plan-context.collector';
import { DailyPlanPromptBuilder } from './daily-plan-prompt.builder';

const buildTask = (title: string): TaskItem => ({
  id: `id-${title}`,
  title,
  source: 'USER_INPUT',
  subtasks: [],
  isCriticalPath: false,
});

const buildDailyPlan = (label: string): DailyPlan => ({
  topPriority: { ...buildTask(`${label}-top`), isCriticalPath: true },
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '(이월 없음)' },
  morning: [buildTask(`${label}-am`)],
  afternoon: [buildTask(`${label}-pm`)],
  blocker: null,
  estimatedHours: 5,
  reasoning: 'r',
});

const buildDailyReview = (note: string): DailyReview => ({
  summary: note,
  impact: { quantitative: [], qualitative: note },
  improvementBeforeAfter: null,
  nextActions: [],
  oneLineAchievement: note,
});

const buildSummary = (date: string, title: string): RecentPlanSummary => ({
  date,
  topPriorityTitle: title,
  estimatedHours: 6,
  criticalPathCount: 1,
  agentRunId: 100,
});

const buildBaseContext = (
  overrides: Partial<DailyPlanContext> = {},
): DailyPlanContext => ({
  userText: '오늘 할 일',
  slackUserId: 'U1',
  githubTasks: null,
  previousPlan: null,
  previousWorklog: null,
  slackMentions: [],
  notionTasks: [],
  recentPlanSummaries: [],
  ...overrides,
});

describe('DailyPlanPromptBuilder', () => {
  let builder: DailyPlanPromptBuilder;

  beforeEach(() => {
    builder = new DailyPlanPromptBuilder();
  });

  it('recentPlanSummaries 가 비어 있으면 "지난 7일 plan 패턴" 섹션 자체가 prompt 에 없다', () => {
    const built = builder.build(buildBaseContext());

    expect(built.prompt).not.toContain('## 지난 7일 plan 패턴');
    expect(built.truncated.droppedSections).toEqual([]);
  });

  it('recentPlanSummaries 가 있으면 prompt 에 "지난 7일 plan 패턴" 섹션 포함', () => {
    const built = builder.build(
      buildBaseContext({
        recentPlanSummaries: [
          buildSummary('2026-04-26', '어제 최우선'),
          buildSummary('2026-04-25', '그제 최우선'),
        ],
      }),
    );

    expect(built.prompt).toContain('## 지난 7일 plan 패턴 (최근순)');
    expect(built.prompt).toContain('어제 최우선');
    expect(built.prompt).toContain('그제 최우선');
    expect(built.truncated.droppedSections).toEqual([]);
  });

  it('cap 초과 시 TRIM_ORDER 우선순위대로 drop — recentPlanSummaries 가 previousPlan / previousWorklog 보다 먼저 drop 된다', () => {
    // recentPlanSummaries 와 previousPlan/Worklog 모두 채워서 합쳐 16KB 초과 강제.
    // recentPlanSummaries 자체 byte 가 cap 가까이 차도록 30 entry 로 부풀린다 (한 줄당 ~70 bytes × 30 ≈ 2KB
    // → 단독으론 cap 안 넘으므로 추가로 user/previous 쪽에 큰 텍스트를 동시에 넣어 합산 16KB 초과시킨다).
    const longTitle = '가'.repeat(2000); // 1 글자 = 3 bytes (UTF-8) → 6KB
    const previousPlan = buildDailyPlan(longTitle);
    const previousReview = buildDailyReview(longTitle);
    const recentSummaries: RecentPlanSummary[] = Array.from(
      { length: 30 },
      (_, index) =>
        buildSummary(`2026-04-${10 + index}`, `${longTitle}-${index}`),
    );

    const built = builder.build(
      buildBaseContext({
        userText: longTitle,
        previousPlan: {
          plan: previousPlan,
          endedAt: new Date('2026-04-26T05:00:00Z'),
          agentRunId: 99,
        },
        previousWorklog: {
          review: previousReview,
          endedAt: new Date('2026-04-26T05:00:00Z'),
          agentRunId: 98,
        },
        recentPlanSummaries: recentSummaries,
      }),
    );

    // recentPlanSummaries 는 previousPlan / previousWorklog 보다 먼저 drop 되어야 한다.
    expect(built.truncated.droppedSections).toContain('recentPlanSummaries');
    const recentDropIndex = built.truncated.droppedSections.indexOf(
      'recentPlanSummaries',
    );
    const previousPlanDropIndex =
      built.truncated.droppedSections.indexOf('previousPlan');
    if (previousPlanDropIndex !== -1) {
      expect(recentDropIndex).toBeLessThan(previousPlanDropIndex);
    }
    expect(built.prompt).not.toContain('## 지난 7일 plan 패턴');
  });
});
