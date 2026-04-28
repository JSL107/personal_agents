import { WeeklySummaryConsumer } from './weekly-summary.consumer';

describe('WeeklySummaryConsumer', () => {
  const mockWorklogUsecase = { execute: jest.fn() };
  const mockAgentRunService = { findRecentSucceededRuns: jest.fn() };
  const mockSlackNotifier = { postMessage: jest.fn() };

  const consumer = new WeeklySummaryConsumer(
    mockWorklogUsecase as any,
    mockAgentRunService as any,
    mockSlackNotifier as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('PM runs 없으면 slack 에 empty 메시지 발송', async () => {
    mockAgentRunService.findRecentSucceededRuns.mockResolvedValue([]);
    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as any);
    expect(mockWorklogUsecase.execute).not.toHaveBeenCalled();
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'C1' }),
    );
  });

  it('PM runs 있으면 worklog usecase 호출', async () => {
    const fakeRun = {
      id: 1,
      output: {
        tasks: [
          {
            title: '작업1',
            timeBlock: 'AM',
            estimatedMinutes: 60,
            subtasks: [],
            lineage: 'NEW',
          },
        ],
        date: '2026-04-28',
        variance: null,
      },
      endedAt: new Date('2026-04-28'),
    };
    mockAgentRunService.findRecentSucceededRuns.mockResolvedValue([fakeRun]);
    mockWorklogUsecase.execute.mockResolvedValue({
      result: {
        summary: 'ok',
        impact: { quantitative: [], qualitative: '좋음' },
        improvementBeforeAfter: null,
        nextActions: [],
        oneLineAchievement: '완료',
      },
      modelUsed: 'test',
      agentRunId: 2,
    });
    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as any);
    expect(mockWorklogUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1' }),
    );
    expect(mockSlackNotifier.postMessage).toHaveBeenCalled();
  });
});
