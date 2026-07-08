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
  taskIds: [`github/repo#${title}`],
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
  inboxItems: [],
  inboxItemIds: [],
  similarPlans: [],
  waitingItems: [],
  ...overrides,
});

describe('DailyPlanPromptBuilder', () => {
  let builder: DailyPlanPromptBuilder;

  beforeEach(() => {
    builder = new DailyPlanPromptBuilder();
  });

  it('conversationContext.userInstruction 이 있으면 [사용자 지시] 섹션을 prompt 최우선(맨 앞)에 포함', () => {
    const built = builder.build(buildBaseContext(), {
      userInstruction: '직전 논의한 개선 항목을 우선순위화',
    });

    expect(built.prompt).toContain('[사용자 지시');
    expect(built.prompt).toContain('직전 논의한 개선 항목을 우선순위화');
    // 최우선 — prompt 맨 앞에 위치.
    expect(built.prompt.indexOf('[사용자 지시')).toBe(0);
  });

  it('conversationContext 가 없거나 userInstruction 이 없으면 [사용자 지시] 섹션 없음 (기존 동작 회귀)', () => {
    expect(builder.build(buildBaseContext()).prompt).not.toContain(
      '[사용자 지시',
    );
    expect(builder.build(buildBaseContext(), {}).prompt).not.toContain(
      '[사용자 지시',
    );
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

  it('recentPlanSummaries 기준 stale 후보가 있으면 정체 태스크 섹션을 prompt 에 포함한다', () => {
    const built = builder.build(
      buildBaseContext({
        recentPlanSummaries: [
          {
            ...buildSummary('2026-07-07', '학교 채팅방'),
            taskIds: ['repo/app#1', 'repo/app#2'],
          },
          {
            ...buildSummary('2026-07-06', '학교 채팅방'),
            taskIds: ['repo/app#1'],
          },
          {
            ...buildSummary('2026-07-05', '학교 채팅방'),
            taskIds: ['repo/app#1'],
          },
          {
            ...buildSummary('2026-07-04', '학교 채팅방'),
            taskIds: ['repo/app#1'],
          },
        ],
      }),
      undefined,
      5,
    );

    expect(built.prompt).toContain('## 정체 태스크 (강등 대상)');
    expect(built.prompt).toContain('repo/app#1 (5일 연속) : 학교 채팅방');
    expect(built.prompt).toContain('stalledTasks');
    expect(built.prompt).not.toContain('repo/app#2 (');
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

  it("userText 가 ', ' 로 2개 이상 짧은 항목으로 split 되면 [사용자 명시 TODO] 섹션으로 렌더", () => {
    const built = builder.build(
      buildBaseContext({ userText: 'PR 리뷰, 회의 준비, 문서 보강' }),
    );

    expect(built.prompt).toContain('[사용자 명시 TODO');
    expect(built.prompt).toContain('- PR 리뷰');
    expect(built.prompt).toContain('- 회의 준비');
    expect(built.prompt).toContain('- 문서 보강');
    expect(built.prompt).not.toContain('[사용자 입력]');
  });

  it("userText 에 ',' 가 없거나 1개 항목만 있으면 기존 [사용자 입력] 섹션 유지", () => {
    const built = builder.build(buildBaseContext({ userText: '오늘 할 일' }));

    expect(built.prompt).toContain('[사용자 입력]\n오늘 할 일');
    expect(built.prompt).not.toContain('[사용자 명시 TODO');
  });

  it("split 기준 ', ' (콤마+공백) 미일치는 단일 자유 텍스트로 유지 (codex/omc P2)", () => {
    // 공백 없는 콤마 ("A,B,C") 는 list 의도가 모호하므로 split 안 함
    const built = builder.build(buildBaseContext({ userText: 'A,B,C' }));
    expect(built.prompt).toContain('[사용자 입력]\nA,B,C');
    expect(built.prompt).not.toContain('[사용자 명시 TODO');
  });

  it('split 결과에 50자 초과 항목이 섞이면 자연 문장으로 간주해 split 안 함 (omc P2)', () => {
    const longTail =
      '특히 카드사 응답이 비정상적으로 느려져서 timeout 이 자주 발생하는 케이스를 우선 살펴봐야 합니다';
    const userText = `결제 API 버그 수정, ${longTail}`;
    const built = builder.build(buildBaseContext({ userText }));
    expect(built.prompt).toContain(`[사용자 입력]\n${userText}`);
    expect(built.prompt).not.toContain('[사용자 명시 TODO');
  });

  it('빈 항목/한 글자만 남는 split 결과는 list 로 보지 않는다', () => {
    // "A, , B" → trim 후 ["A", "B"] → "A" 가 1자라 min length 미달 → 단일 입력으로 fallback
    const userText = 'A, , B';
    const built = builder.build(buildBaseContext({ userText }));
    expect(built.prompt).toContain(`[사용자 입력]\n${userText}`);
    expect(built.prompt).not.toContain('[사용자 명시 TODO');
  });
});
