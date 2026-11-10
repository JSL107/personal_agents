/* eslint-disable @typescript-eslint/no-require-imports */
import { AiWeeklyError } from '../../../ai-tool-weekly/domain/ai-weekly-error';

jest.mock('../../../ai-tool-weekly/domain/ai-weekly-metrics.parser');
jest.mock('../../../slack/format/ai-tool-weekly.formatter');

jest.resetModules();
const { AiToolWeeklyAutopilotTask } =
  require('./ai-tool-weekly.autopilot-task') as typeof import('./ai-tool-weekly.autopilot-task');
const { parseAiWeeklyMetrics } =
  require('../../../ai-tool-weekly/domain/ai-weekly-metrics.parser') as typeof import('../../../ai-tool-weekly/domain/ai-weekly-metrics.parser');
const { formatAiToolWeekly } =
  require('../../../slack/format/ai-tool-weekly.formatter') as typeof import('../../../slack/format/ai-tool-weekly.formatter');
const parse = jest.mocked(parseAiWeeklyMetrics);
const format = jest.mocked(formatAiToolWeekly);
const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-11-10' };

describe('AiToolWeeklyAutopilotTask', () => {
  const runner = { run: jest.fn() };
  const github = { listAuthorMergedPullRequestsSince: jest.fn() };
  let values: Record<string, string>;
  let task: InstanceType<typeof AiToolWeeklyAutopilotTask>;

  beforeEach(() => {
    jest.resetAllMocks();
    values = {
      AUTOPILOT_HARNESS_TARGET: 'C0HARNESS',
      IMPACT_REPORT_GITHUB_AUTHOR: 'user',
    };
    task = new AiToolWeeklyAutopilotTask(
      { get: (key: string) => values[key] } as never,
      runner as never,
      github as never,
    );
    runner.run.mockResolvedValue({});
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([]);
    parse.mockReturnValue({ metrics: {} as never, droppedNameCount: 0 });
    format.mockReturnValue({ summary: '헤더 (휴리스틱)', detail: '상세' });
  });

  it('채널 설정이 비면 보충 작업도 수집하지 않는다', async () => {
    values.AUTOPILOT_HARNESS_TARGET = '   ';
    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(runner.run).not.toHaveBeenCalled();
    expect(github.listAuthorMergedPullRequestsSince).not.toHaveBeenCalled();
  });

  it('기간과 상세 실패 옵션으로 PR을 조회하고 보고서를 반환한다', async () => {
    github.listAuthorMergedPullRequestsSince.mockResolvedValue([
      { repo: 'schoolbell-e/a', mergedAt: '2026-11-03T00:00:00Z' },
    ]);
    await expect(task.run(context)).resolves.toMatchObject({
      skip: false,
      summaryText: '헤더 (휴리스틱)',
    });
    expect(github.listAuthorMergedPullRequestsSince).toHaveBeenCalledWith({
      repo: null,
      author: 'user',
      sinceIsoDate: '2026-11-02T00:00:00+09:00',
      untilIsoDate: '2026-11-08T23:59:59+09:00',
      limit: 100,
      throwOnDetailFailure: true,
    });
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequests: {
          status: 'ok',
          company: 1,
          personal: 0,
          truncated: false,
        },
      }),
    );
  });

  it('PR 조회 실패 시 실패 상태로 나머지 보고서를 만든다', async () => {
    github.listAuthorMergedPullRequestsSince.mockRejectedValue(
      new Error('private'),
    );
    await task.run(context);
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({ pullRequests: { status: 'error' } }),
    );
  });

  it('100건 조회는 잘린 결과로 표시하고 회사 수를 구분한다', async () => {
    github.listAuthorMergedPullRequestsSince.mockResolvedValue(
      Array.from({ length: 100 }, () => ({
        repo: 'personal/a',
        mergedAt: '2026-11-03T00:00:00Z',
      })),
    );
    await task.run(context);
    expect(format).toHaveBeenCalledWith(
      expect.objectContaining({
        pullRequests: {
          status: 'ok',
          company: 0,
          personal: 100,
          truncated: true,
        },
      }),
    );
  });

  it('runner와 parser 오류는 그대로 전달한다', async () => {
    const error = new AiWeeklyError({ code: 'SHAPE', exitCode: null });
    runner.run.mockRejectedValueOnce(error);
    await expect(task.run(context)).rejects.toThrow('exit=none code=SHAPE');
    parse.mockImplementationOnce(() => {
      throw error;
    });
    await expect(task.run(context)).rejects.toThrow('exit=none code=SHAPE');
  });

  it('제거한 이름의 개수만 경고한다', async () => {
    parse.mockReturnValue({ metrics: {} as never, droppedNameCount: 2 });
    const warn = jest.spyOn(
      (task as never as { logger: { warn: (message: string) => void } }).logger,
      'warn',
    );
    await task.run(context);
    expect(warn).toHaveBeenCalledWith('이름 검증 탈락 2건');
  });
});
