import { WorkReviewerException } from '../../../agent/work-reviewer/domain/work-reviewer.exception';
import { WorkReviewerErrorCode } from '../../../agent/work-reviewer/domain/work-reviewer-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { WorkReviewerAutopilotTask } from './work-reviewer.autopilot-task';

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

const SECOND_MERGED_PULL_REQUEST = {
  ...MERGED_PULL_REQUEST,
  number: 972,
  title: '계획 없는 날 회고',
  url: 'https://github.com/schoolbell-e/sbe-server/pull/972',
};

const makePmRun = (date: string, tasks: string[]) => ({
  endedAt: new Date(date),
  output: {
    topPriority: {
      id: 'tp',
      title: tasks[0] ?? '최우선',
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
});

const makeOutcome = () => ({
  result: {
    summary: '오늘 worklog 요약',
    impact: {
      quantitative: ['PR 1건 머지'],
      qualitative: '코드 품질 개선',
    },
    improvementBeforeAfter: null,
    decisions: [],
    risks: [],
    nextActions: ['내일 리뷰'],
    oneLineAchievement: 'PR 리뷰 완료',
  },
  modelUsed: 'codex-cli',
  agentRunId: 7,
});

const makeHumanizeService = () => ({
  humanize: jest
    .fn()
    .mockImplementation((fields: Record<string, string>) =>
      Promise.resolve(fields),
    ),
});

const makeConfig = (author: string | null = 'idaeri') => ({
  get: jest.fn().mockImplementation((key: string) => {
    if (key === 'IMPACT_REPORT_GITHUB_AUTHOR') {
      return author ?? undefined;
    }
    if (key === 'IMPACT_REPORT_GITHUB_REPO') {
      return 'schoolbell-e/sbe-server';
    }
    return undefined;
  }),
});

describe('WorkReviewerAutopilotTask', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-17T10:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('id 는 work-reviewer', () => {
    const task = new WorkReviewerAutopilotTask(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(task.id).toBe('work-reviewer');
  });

  it('정상 경로: summaryText=헤더+summary, detailText=detail+footer, 윤문 호출됨', async () => {
    jest.setSystemTime(new Date('2026-06-18T10:00:00.000Z'));
    const pmRun = makePmRun('2026-06-17', ['PR 리뷰']);
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([pmRun]);
    const outcome = makeOutcome();
    const execute = jest.fn().mockResolvedValue(outcome);
    const humanizeService = makeHumanizeService();
    const githubClient = {
      listAuthorMergedPullRequestsSince: jest
        .fn()
        .mockResolvedValue([MERGED_PULL_REQUEST]),
    };

    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      humanizeService as never,
      githubClient as never,
      makeConfig() as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('📝 *Work Reviewer —');
    expect(result.summaryText).toContain('2026-06-17');
    expect(result.summaryText).not.toContain('질적 영향'); // detail 내용은 summaryText 에 없음
    expect(result.detailText).toBeDefined();
    expect(result.detailText).toContain('질적 영향'); // detail 섹션
    expect(result.detailText).toContain('run #7'); // footer
    expect(humanizeService.humanize).toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1' }),
    );
    expect(execute.mock.calls[0][0].workText).toContain(
      'schoolbell-e/sbe-server#971',
    );
    expect(githubClient.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      {
        repo: 'schoolbell-e/sbe-server',
        author: 'idaeri',
        sinceIsoDate: '2026-06-16T15:00:00.000Z',
        untilIsoDate: '2026-06-17T15:00:00.000Z',
        throwOnDetailFailure: true,
        limit: 30,
      },
    );
  });

  it('오늘 PM plan 없음 + 머지 PR 2건 → 계획 없음과 두 실적으로 worklog 생성', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const execute = jest.fn().mockResolvedValue(makeOutcome());
    const githubClient = {
      listAuthorMergedPullRequestsSince: jest
        .fn()
        .mockResolvedValue([MERGED_PULL_REQUEST, SECOND_MERGED_PULL_REQUEST]),
    };
    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      makeHumanizeService() as never,
      githubClient as never,
      makeConfig() as never,
    );

    await task.run(CTX);

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workText: expect.stringContaining('(오늘 작성된 PM plan 없음)'),
      }),
    );
    expect(execute.mock.calls[0][0].workText).toContain(
      'schoolbell-e/sbe-server#971',
    );
    expect(execute.mock.calls[0][0].workText).toContain(
      'schoolbell-e/sbe-server#972',
    );
  });

  it('오늘 PM plan 없음 + 머지 PR 0건 → GenerateWorklog 미호출, 기존 안내문 반환', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const execute = jest.fn();
    const humanizeService = makeHumanizeService();

    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      humanizeService as never,
      {
        listAuthorMergedPullRequestsSince: jest.fn().mockResolvedValue([]),
      } as never,
      makeConfig() as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain(
      '오늘 작성된 PM plan 이 없어 worklog 자동 생성을 건너뜁니다. `/today` 로 plan 을 먼저 만들어주세요.',
    );
    expect(result.detailText).toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
  });

  it('오늘 PM plan 없음 + GitHub 조회 실패 → 예외를 던진다', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const execute = jest.fn();
    const githubClient = {
      listAuthorMergedPullRequestsSince: jest
        .fn()
        .mockRejectedValue(new Error('rate limit')),
    };
    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      makeHumanizeService() as never,
      githubClient as never,
      makeConfig() as never,
    );

    await expect(task.run(CTX)).rejects.toThrow(
      'Work Reviewer 실적 조회 실패로 회고 생성을 보류합니다: GitHub 조회 실패: rate limit',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('오늘 PM plan 없음 + env IMPACT_REPORT_GITHUB_AUTHOR 미설정 → skip 안내문에 사유 포함', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const execute = jest.fn();
    const githubClient = { listAuthorMergedPullRequestsSince: jest.fn() };
    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      makeHumanizeService() as never,
      githubClient as never,
      makeConfig(null) as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain(
      '오늘 작성된 PM plan 이 없어 worklog 자동 생성을 건너뜁니다. `/today` 로 plan 을 먼저 만들어주세요.',
    );
    expect(result.summaryText).toContain(
      'env IMPACT_REPORT_GITHUB_AUTHOR 미설정',
    );
    expect(result.detailText).toBeUndefined();
    expect(
      githubClient.listAuthorMergedPullRequestsSince,
    ).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('GenerateWorklog EMPTY_WORK_INPUT throw → graceful 안내문(skip=false, detailText 없음)', async () => {
    const pmRun = makePmRun('2026-06-17', ['']);
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([pmRun]);
    const execute = jest.fn().mockRejectedValue(
      new WorkReviewerException({
        code: WorkReviewerErrorCode.EMPTY_WORK_INPUT,
        message: '비어있음',
        status: DomainStatus.BAD_REQUEST,
      }),
    );
    const humanizeService = makeHumanizeService();

    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      humanizeService as never,
      {
        listAuthorMergedPullRequestsSince: jest.fn().mockResolvedValue([]),
      } as never,
      makeConfig() as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toBeDefined();
    expect(result.summaryText).toMatch(/worklog|작업|입력/);
    expect(result.detailText).toBeUndefined();
  });

  it('그 외 에러는 throw (consumer 가 실패 통지)', async () => {
    const findRecentSucceededRuns = jest
      .fn()
      .mockRejectedValue(new Error('db down'));
    const execute = jest.fn();
    const humanizeService = makeHumanizeService();

    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      humanizeService as never,
      {} as never,
      makeConfig() as never,
    );

    await expect(task.run(CTX)).rejects.toThrow('db down');
  });

  it('plan 파싱 실패 + GitHub 조회 실패도 formatter 폴백으로 worklog 생성을 계속한다', async () => {
    const findRecentSucceededRuns = jest
      .fn()
      .mockResolvedValue([
        { output: 'not-a-plan', endedAt: new Date('2026-06-17T09:00:00Z') },
      ]);
    const execute = jest.fn().mockResolvedValue(makeOutcome());
    const githubClient = {
      listAuthorMergedPullRequestsSince: jest
        .fn()
        .mockRejectedValue(new Error('rate limit')),
    };
    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      makeHumanizeService() as never,
      githubClient as never,
      makeConfig() as never,
    );

    await task.run(CTX);

    expect(githubClient.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith(
      expect.objectContaining({
        untilIsoDate: '2026-06-17T15:00:00.000Z',
        throwOnDetailFailure: true,
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workText: expect.stringContaining('GitHub 조회 실패: rate limit'),
      }),
    );
    expect(execute.mock.calls[0][0].workText).toContain('(plan 파싱 불가)');
    expect(execute.mock.calls[0][0].workText).not.toContain(
      '(오늘 작성된 PM plan 없음)',
    );
  });

  it('GitHub author env 미설정이면 조회하지 않고 조회 불가 사유를 입력한다', async () => {
    const findRecentSucceededRuns = jest
      .fn()
      .mockResolvedValue([makePmRun('2026-06-17', ['PR 리뷰'])]);
    const execute = jest.fn().mockResolvedValue(makeOutcome());
    const githubClient = { listAuthorMergedPullRequestsSince: jest.fn() };
    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      makeHumanizeService() as never,
      githubClient as never,
      makeConfig(null) as never,
    );

    await task.run(CTX);

    expect(
      githubClient.listAuthorMergedPullRequestsSince,
    ).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        workText: expect.stringContaining(
          'env IMPACT_REPORT_GITHUB_AUTHOR 미설정',
        ),
      }),
    );
  });
});
