import { WorkReviewerException } from '../../../agent/work-reviewer/domain/work-reviewer.exception';
import { WorkReviewerErrorCode } from '../../../agent/work-reviewer/domain/work-reviewer-error-code.enum';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { WorkReviewerAutopilotTask } from './work-reviewer.autopilot-task';

const CTX = { ownerSlackUserId: 'U1', firedAtKst: '2026-06-17' };

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

describe('WorkReviewerAutopilotTask', () => {
  it('id 는 work-reviewer', () => {
    const task = new WorkReviewerAutopilotTask(
      {} as never,
      {} as never,
      {} as never,
    );
    expect(task.id).toBe('work-reviewer');
  });

  it('정상 경로: summaryText=헤더+summary, detailText=detail+footer, 윤문 호출됨', async () => {
    const pmRun = makePmRun('2026-06-17', ['PR 리뷰']);
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([pmRun]);
    const outcome = makeOutcome();
    const execute = jest.fn().mockResolvedValue(outcome);
    const humanizeService = makeHumanizeService();

    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      humanizeService as never,
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
  });

  it('오늘 PM plan 없음 → GenerateWorklog 미호출, skip=false 안내문 반환, detailText 없음', async () => {
    const findRecentSucceededRuns = jest.fn().mockResolvedValue([]);
    const execute = jest.fn();
    const humanizeService = makeHumanizeService();

    const task = new WorkReviewerAutopilotTask(
      { findRecentSucceededRuns } as never,
      { execute } as never,
      humanizeService as never,
    );

    const result = await task.run(CTX);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('plan');
    expect(result.detailText).toBeUndefined();
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
    );

    await expect(task.run(CTX)).rejects.toThrow('db down');
  });
});
