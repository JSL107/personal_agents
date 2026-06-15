import { DailyPlanContextCollector } from './daily-plan-context.collector';
import { SyncContextUsecase } from './sync-context.usecase';

// SyncContextUsecase 는 DailyPlanContextCollector 가 수집한 5종 컨텍스트를
// 모델 호출/AgentRun 기록 없이 ContextSummary 로 요약한다.
describe('SyncContextUsecase', () => {
  it('5종 컨텍스트를 수집해 요약으로 변환한다', async () => {
    const collect = jest.fn().mockResolvedValue({
      githubTasks: {
        issues: [{ id: 1 }, { id: 2 }],
        pullRequests: [{ id: 3 }],
      },
      notionTasks: [{ id: 'a' }],
      slackMentions: [{ ts: '1' }, { ts: '2' }, { ts: '3' }],
      previousPlan: {
        agentRunId: 11,
        endedAt: new Date('2026-06-10T00:00:00.000Z'),
      },
      previousWorklog: null,
    });
    const usecase = new SyncContextUsecase({
      collect,
    } as unknown as DailyPlanContextCollector);

    const summary = await usecase.execute({ slackUserId: 'U1' });

    expect(collect).toHaveBeenCalledWith({ userText: '', slackUserId: 'U1' });
    expect(summary.github).toEqual({
      fetchSucceeded: true,
      issueCount: 2,
      pullRequestCount: 1,
    });
    expect(summary.notion.taskCount).toBe(1);
    expect(summary.slack).toEqual({ mentionCount: 3, sinceHours: 24 });
    expect(summary.previousPlan).toEqual({
      agentRunId: 11,
      endedAt: '2026-06-10T00:00:00.000Z',
    });
    expect(summary.previousWorklog).toBeNull();
  });

  it('githubTasks 가 null 이면 fetchSucceeded=false 로 요약한다', async () => {
    const collect = jest.fn().mockResolvedValue({
      githubTasks: null,
      notionTasks: [],
      slackMentions: [],
      previousPlan: null,
      previousWorklog: null,
    });
    const usecase = new SyncContextUsecase({
      collect,
    } as unknown as DailyPlanContextCollector);

    const summary = await usecase.execute({ slackUserId: 'U9' });

    expect(summary.github.fetchSucceeded).toBe(false);
    expect(summary.github.issueCount).toBe(0);
    expect(summary.github.pullRequestCount).toBe(0);
    expect(summary.notion.taskCount).toBe(0);
    expect(summary.slack.mentionCount).toBe(0);
  });
});
