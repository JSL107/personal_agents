import { CeoException } from '../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { CeoMetaCronConsumer } from './ceo-meta-cron.consumer';

describe('CeoMetaCronConsumer', () => {
  const mockCeoUsecase = { execute: jest.fn() };
  const mockSlackNotifier = { postMessage: jest.fn() };
  const mockCronAlerter = { notifyCronFailure: jest.fn() };

  const consumer = new CeoMetaCronConsumer(
    mockCeoUsecase as never,
    mockSlackNotifier as never,
    mockCronAlerter as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockCronAlerter.notifyCronFailure.mockResolvedValue(undefined);
  });

  const sampleOutcome = (range: 'WEEK' | 'TODAY' = 'WEEK') => ({
    result: {
      range,
      sourcePhaseRuns: { poEvalRunId: 42 },
      contextDriftReport: { observations: ['drift 관찰 1'] },
      docsQualityReport: { findings: ['문서 누락 1'] },
      finalSummary: '주간 메타 회고 요약.',
      schemaVersion: 1 as const,
    },
    modelUsed: 'claude',
    agentRunId: 70,
  });

  it('정상 — Slack 발송 1회 + range/triggerType 전달 + KST 헤더', async () => {
    mockCeoUsecase.execute.mockResolvedValue(sampleOutcome('WEEK'));

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', range: 'WEEK' },
    } as never);

    expect(mockCeoUsecase.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      range: 'WEEK',
      triggerType: 'WEEKLY_CEO_META_CRON',
    });
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.target).toBe('C1');
    // KST 날짜 + 주간 회고 헤더.
    expect(call.text).toMatch(
      /🧭 \*CEO Meta — \d{4}-\d{2}-\d{2} \(최근 7일 자동 회고\)\*/,
    );
    // body — finalSummary 포함.
    expect(call.text).toContain('주간 메타 회고 요약');
  });

  it('TODAY range — 헤더에 "최근 24시간" 표시', async () => {
    mockCeoUsecase.execute.mockResolvedValue(sampleOutcome('TODAY'));

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', range: 'TODAY' },
    } as never);

    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.text).toMatch(/최근 24시간 자동 회고/);
  });

  it('NO_PO_EVAL_RUN 면 graceful skip + 안내 메시지', async () => {
    mockCeoUsecase.execute.mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '최근 7일 안 PO_EVAL SUCCEEDED run 없음.',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', range: 'WEEK' },
    } as never);

    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.text).toContain('skip');
    expect(call.text).toMatch(/🌙 \*CEO Meta — \d{4}-\d{2}-\d{2} skip\*/);
    expect(call.text).toContain('다음 주기에 다시 시도');
  });

  it('NO_PO_EVAL_RUN 외 다른 에러는 그대로 propagate (BullMQ 재시도)', async () => {
    mockCeoUsecase.execute.mockRejectedValue(new Error('claude rate limit'));

    await expect(
      consumer.process({
        data: { ownerSlackUserId: 'U1', target: 'C1', range: 'WEEK' },
      } as never),
    ).rejects.toThrow('claude rate limit');
    expect(mockSlackNotifier.postMessage).not.toHaveBeenCalled();
    // throw 직전 owner DM 알람 발사 — cron 운영자가 즉시 인지.
    expect(mockCronAlerter.notifyCronFailure).toHaveBeenCalledWith({
      cronName: 'CEO Meta Cron',
      ownerSlackUserId: 'U1',
      errorMessage: 'claude rate limit',
    });
  });

  it('NO_PO_EVAL_RUN graceful skip 인 경우 알람 미발사 (사용자 활동 없음 = 진단 불필요)', async () => {
    mockCeoUsecase.execute.mockRejectedValue(
      new CeoException({
        code: CeoErrorCode.NO_PO_EVAL_RUN,
        message: '최근 7일 안 PO_EVAL SUCCEEDED run 없음.',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', range: 'WEEK' },
    } as never);

    expect(mockCronAlerter.notifyCronFailure).not.toHaveBeenCalled();
  });
});
