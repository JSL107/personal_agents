import { ExtractRevisionConventionsUsecase } from '../../../agent/blog/application/extract-revision-conventions.usecase';
import { MeasureBlogRevisionUsecase } from '../../../agent/blog/application/measure-blog-revision.usecase';
import {
  AgentRunService,
  ExecuteAgentRunInput,
} from '../../../agent-run/application/agent-run.service';
import { AutopilotTaskResult } from '../../domain/autopilot-task.port';
import { BlogRevisionReportAutopilotTask } from './blog-revision-report.autopilot-task';

describe('BlogRevisionReportAutopilotTask 원장', () => {
  const measure = { isConfigured: jest.fn(), execute: jest.fn() };
  const records: unknown[] = [];
  const extract = {
    execute: jest.fn().mockResolvedValue({
      conventions: ['중복 결론을 덜어낸다.'],
      modelUsed: 'codex-cli',
    }),
  };
  const execute = jest.fn(
    async (input: ExecuteAgentRunInput<AutopilotTaskResult>) => {
      const execution = await input.run({
        agentRunId: 1,
        updateInputSnapshot: jest.fn(),
      });
      records.push(execution.output);
      return {
        result: execution.result,
        agentRunId: 1,
        modelUsed: execution.modelUsed,
      };
    },
  );
  const task = new BlogRevisionReportAutopilotTask(
    measure as unknown as MeasureBlogRevisionUsecase,
    { execute } as unknown as AgentRunService,
    extract as unknown as ExtractRevisionConventionsUsecase,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    records.length = 0;
  });
  it('미설정도 이유를 원장에 남기고 카드는 생략한다', async () => {
    measure.isConfigured.mockReturnValue(false);
    expect(await task.run()).toEqual({ skip: true });
    expect(records).toEqual([
      expect.objectContaining({
        skipReason: 'NOT_CONFIGURED',
        conventions: [],
      }),
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agentType: 'BLOG_REVISION',
        triggerType: 'WEEKLY_BLOG_REVISION_CRON',
        inputSnapshot: { windowDays: 14, lookbackDays: 28 },
      }),
    );
    expect(measure.execute).not.toHaveBeenCalled();
  });
  it('발행 없음도 원장에 남긴다', async () => {
    measure.isConfigured.mockReturnValue(true);
    measure.execute.mockResolvedValue({
      rows: [],
      summary: { postCount: 0, averagePercent: 0, untouchedCount: 0 },
      unmatchedCount: 2,
    });
    expect(await task.run()).toEqual({ skip: true });
    expect(records).toEqual([
      expect.objectContaining({
        skipReason: 'NO_RECENT_POSTS',
        unmatchedCount: 2,
      }),
    ]);
  });
  it('최근 창의 수치와 추출 규칙을 같은 원장에 남긴다', async () => {
    measure.isConfigured.mockReturnValue(true);
    measure.execute.mockResolvedValue({
      rows: [
        {
          path: 'post.md',
          publishedAt: new Date(Date.now() - 86400000),
          count: { percent: 50, totalLines: 2, addedLines: 1, removedLines: 0 },
        },
      ],
      summary: { postCount: 1, averagePercent: 50, untouchedCount: 0 },
      unmatchedCount: 1,
    });
    const result = await task.run();
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('50%');
    expect(records).toEqual([
      {
        recentAveragePercent: 50,
        recentPostCount: 1,
        unmatchedCount: 1,
        conventions: ['중복 결론을 덜어낸다.'],
      },
    ]);
  });
  it('집계 실패를 다시 던져 재시도를 유지한다', async () => {
    measure.isConfigured.mockReturnValue(true);
    measure.execute.mockRejectedValue(new Error('집계 실패'));
    await expect(task.run()).rejects.toThrow('집계 실패');
  });
});
