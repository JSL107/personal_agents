import { CeoException } from '../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { WeeklySummaryConsumer } from './weekly-summary.consumer';

describe('WeeklySummaryConsumer', () => {
  const mockWorklogUsecase = { execute: jest.fn() };
  const mockCeoMetaUsecase = { execute: jest.fn() };
  const mockAgentRunService = { findRecentSucceededRuns: jest.fn() };
  const mockSlackNotifier = { postMessage: jest.fn() };
  const mockCronIdempotency = {
    acquireOnce: jest.fn().mockResolvedValue(true),
  } as unknown as CronIdempotencyService;

  const consumer = new WeeklySummaryConsumer(
    mockWorklogUsecase as any,
    mockCeoMetaUsecase as any,
    mockAgentRunService as any,
    mockSlackNotifier as any,
    mockCronIdempotency,
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
    mockCeoMetaUsecase.execute.mockResolvedValue({
      result: {
        range: 'WEEK',
        sourcePhaseRuns: { poEvalRunId: 10 },
        contextDriftReport: { observations: [] },
        docsQualityReport: { findings: [] },
        finalSummary: '이번 주 이상 없음',
        schemaVersion: 1,
      },
      modelUsed: 'claude',
      agentRunId: 3,
    });
    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as any);
    expect(mockWorklogUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({ slackUserId: 'U1' }),
    );
    expect(mockSlackNotifier.postMessage).toHaveBeenCalled();
  });

  it('PO_EVAL run 있으면 worklog + CEO meta 모두 발송', async () => {
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
    mockCeoMetaUsecase.execute.mockResolvedValue({
      result: {
        range: 'WEEK',
        sourcePhaseRuns: { poEvalRunId: 10 },
        contextDriftReport: { observations: ['drift 관찰됨'] },
        docsQualityReport: { findings: [] },
        finalSummary: '이번 주 요약',
        schemaVersion: 1,
      },
      modelUsed: 'claude',
      agentRunId: 3,
    });

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as any);

    expect(mockWorklogUsecase.execute).toHaveBeenCalledTimes(1);
    expect(mockCeoMetaUsecase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        slackUserId: 'U1',
        range: 'WEEK',
        triggerType: 'WEEKLY_CEO_META_CRON',
      }),
    );
    // worklog 메시지 + CEO meta 메시지 총 2회 postMessage
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(2);
  });

  it('PO_EVAL run 없으면 worklog 만 발송 + CEO graceful skip 안내 메시지', async () => {
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
    mockCeoMetaUsecase.execute.mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '최근 7일 내 PO_EVAL 의 성공 run 이 없습니다.',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as any);

    expect(mockWorklogUsecase.execute).toHaveBeenCalledTimes(1);
    expect(mockCeoMetaUsecase.execute).toHaveBeenCalledTimes(1);
    // worklog 메시지 + CEO skip 안내 메시지 총 2회 postMessage
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(2);
    const skipCall = mockSlackNotifier.postMessage.mock.calls[1][0];
    expect(skipCall.text).toContain('skip');
  });

  it('stalled 재처리 — CEO meta 키가 이미 발송됨이면 worklog 만 발송하고 CEO 는 별도 키로 skip', async () => {
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
    mockCeoMetaUsecase.execute.mockResolvedValue({
      result: {
        range: 'WEEK',
        sourcePhaseRuns: { poEvalRunId: 10 },
        contextDriftReport: { observations: [] },
        docsQualityReport: { findings: [] },
        finalSummary: '요약',
        schemaVersion: 1,
      },
      modelUsed: 'claude',
      agentRunId: 3,
    });
    // worklog 키는 첫 발송 허용, ceo-meta 키는 이미 발송됨(stalled 재처리 추정) → CEO 발송 skip.
    (mockCronIdempotency.acquireOnce as jest.Mock).mockImplementation(
      (key: string) => Promise.resolve(!key.includes('ceo-meta')),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as any);

    // CEO meta 는 별도 :ceo-meta: 키로 가드됨 — worklog 와 다른 키.
    expect(mockCronIdempotency.acquireOnce).toHaveBeenCalledWith(
      expect.stringContaining('ceo-meta'),
      expect.any(Number),
    );
    // ceo-meta 키가 false 이므로 worklog 만 발송 (CEO meta 는 skip).
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);

    (mockCronIdempotency.acquireOnce as jest.Mock).mockResolvedValue(true);
  });
});
