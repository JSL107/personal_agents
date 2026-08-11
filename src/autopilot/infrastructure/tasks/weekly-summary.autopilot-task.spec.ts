import { CeoException } from '../../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../../agent/ceo/domain/ceo-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { WeeklySummaryAutopilotTask } from './weekly-summary.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

const MERGED_PULL_REQUEST = {
  number: 971,
  title: '급식 룰 저장',
  body: '',
  repo: 'schoolbell-e/sbe-server',
  url: 'https://github.com/schoolbell-e/sbe-server/pull/971',
  state: 'merged' as const,
  mergedAt: '2026-06-17T04:00:00.000Z',
  updatedAt: '2026-06-17T04:00:00.000Z',
  additions: 412,
  deletions: 88,
  changedFilesCount: 14,
};

const makeConfig = () => ({
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'IMPACT_REPORT_GITHUB_AUTHOR') {
      return 'idaeri';
    }
    if (key === 'IMPACT_REPORT_GITHUB_REPO') {
      return 'schoolbell-e/sbe-server';
    }
    return undefined;
  }),
});

describe('WeeklySummaryAutopilotTask', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-17T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('id 는 weekly-summary', () => {
    expect(
      new WeeklySummaryAutopilotTask(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      ).id,
    ).toBe('weekly-summary');
  });

  it('이번 주 PM run 0건 → graceful skip 안내(skip=false, worklog/CEO 미호출)', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const worklogExecute = jest.fn();
    const ceoExecute = jest.fn();
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: ceoExecute } as never,
      {} as never,
      makeConfig() as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    expect(out.summaryText).toContain('skip');
    expect(worklogExecute).not.toHaveBeenCalled();
    expect(ceoExecute).not.toHaveBeenCalled();
    expect(findRecentSucceededRuns).toHaveBeenCalledWith(
      expect.objectContaining({ sinceDays: 7 }),
    );
  });

  it('worklog 성공 시 요약은 summaryText, 근거 detail 은 detailText 스레드로 분리 (CEO skip 시 CEO detail 없음)', async () => {
    const findRecentSucceededRuns = jest
      .fn()
      .mockResolvedValue([
        { output: 'not-a-plan', endedAt: new Date('2026-06-17T09:00:00Z') },
      ]);
    const worklogExecute = jest.fn().mockResolvedValue({
      result: {
        summary: '이번주 요약',
        oneLineAchievement: '핵심 성과',
        impact: { quantitative: ['PR 3건'], qualitative: '질적 영향 텍스트' },
        improvementBeforeAfter: null,
        nextActions: ['다음주 액션'],
      },
      modelUsed: 'codex-cli',
      agentRunId: 42,
    });
    const ceoExecute = jest.fn().mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '없음',
        status: DomainStatus.NOT_FOUND,
      }),
    );
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: ceoExecute } as never,
      {
        listAuthorMergedPullRequestsSince: jest
          .fn()
          .mockResolvedValue([MERGED_PULL_REQUEST]),
      } as never,
      makeConfig() as never,
    );

    const out = await task.run(CTX);

    expect(out.skip).toBe(false);
    // 메인(summaryText): worklog 헤더 + 요약, CEO skip 안내. 근거 섹션은 없다.
    expect(out.summaryText).toContain('Weekly Summary');
    expect(out.summaryText).toContain('이번주 요약');
    expect(out.summaryText).toContain('CEO Meta');
    expect(out.summaryText).not.toContain('정량 근거');
    expect(out.summaryText).not.toContain('질적 영향');
    // 스레드(detailText): worklog detail(정량 근거·질적 영향·다음 액션) + model 푸터. CEO skip 이라 CEO detail 없음.
    expect(out.detailText).toContain('정량 근거');
    expect(out.detailText).toContain('질적 영향');
    expect(out.detailText).toContain('다음 액션');
    expect(out.detailText).toContain('run #42');
  });

  it('오늘 포함 7일 KST 창으로 머지 PR을 조회하고 실적 섹션을 worklog 입력에 포함한다', async () => {
    jest.setSystemTime(new Date('2026-06-18T10:00:00.000Z'));
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([
      {
        output: {
          topPriority: {
            id: 'tp',
            title: '주간 계획',
            source: 'USER_INPUT',
            subtasks: [],
            isCriticalPath: true,
          },
          morning: [],
          afternoon: [],
          blocker: null,
          estimatedHours: 8,
          reasoning: '테스트',
          varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
        },
        endedAt: new Date('2026-06-16T16:00:00.000Z'),
      },
    ]);
    const worklogExecute = jest.fn().mockResolvedValue({
      result: {
        summary: '이번주 요약',
        oneLineAchievement: '핵심 성과',
        impact: { quantitative: [], qualitative: '질적 영향 텍스트' },
        improvementBeforeAfter: null,
        nextActions: ['다음주 액션'],
      },
      modelUsed: 'codex-cli',
      agentRunId: 42,
    });
    const githubClient = {
      listAuthorMergedPullRequestsSince: jest
        .fn()
        .mockResolvedValue([MERGED_PULL_REQUEST]),
    };
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: jest.fn().mockRejectedValue(new Error('ceo down')) } as never,
      githubClient as never,
      makeConfig() as never,
    );

    await task.run(CTX);

    expect(githubClient.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      {
        repo: 'schoolbell-e/sbe-server',
        author: 'idaeri',
        sinceIsoDate: '2026-06-10T15:00:00.000Z',
        limit: 60,
      },
    );
    expect(worklogExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workText: expect.stringContaining('## 실적 (머지된 PR 1건)'),
      }),
    );
    expect(worklogExecute.mock.calls[0][0].workText).toContain(
      'schoolbell-e/sbe-server#971',
    );
    expect(worklogExecute.mock.calls[0][0].workText).toContain('[2026-06-17]');
  });

  it.each([
    {
      name: 'GitHub 조회 실패',
      author: 'idaeri',
      githubError: new Error('rate limit'),
      reason: 'GitHub 조회 실패: rate limit',
    },
    {
      name: 'GitHub author env 미설정',
      author: undefined,
      githubError: null,
      reason: 'env IMPACT_REPORT_GITHUB_AUTHOR 미설정',
    },
  ])('$name 이어도 주간 worklog 생성을 계속한다', async (scenario) => {
    const findRecentSucceededRuns = jest
      .fn()
      .mockResolvedValue([
        { output: 'not-a-plan', endedAt: new Date('2026-06-17T09:00:00Z') },
      ]);
    const worklogExecute = jest.fn().mockResolvedValue({
      result: {
        summary: '이번주 요약',
        oneLineAchievement: '핵심 성과',
        impact: { quantitative: [], qualitative: '질적 영향 텍스트' },
        improvementBeforeAfter: null,
        nextActions: ['다음주 액션'],
      },
      modelUsed: 'codex-cli',
      agentRunId: 42,
    });
    const listAuthorMergedPullRequestsSince = scenario.githubError
      ? jest.fn().mockRejectedValue(scenario.githubError)
      : jest.fn();
    const config = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'IMPACT_REPORT_GITHUB_AUTHOR') {
          return scenario.author;
        }
        return undefined;
      }),
    };
    const task = new WeeklySummaryAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute: worklogExecute } as never,
      { execute: jest.fn().mockRejectedValue(new Error('ceo down')) } as never,
      { listAuthorMergedPullRequestsSince } as never,
      config as never,
    );

    await task.run(CTX);

    expect(worklogExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        workText: expect.stringContaining(scenario.reason),
      }),
    );
    if (!scenario.author) {
      expect(listAuthorMergedPullRequestsSince).not.toHaveBeenCalled();
    }
  });
});
