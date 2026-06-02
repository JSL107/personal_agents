import { ImpactReporterException } from '../../agent/impact-reporter/domain/impact-reporter.exception';
import { ImpactReporterErrorCode } from '../../agent/impact-reporter/domain/impact-reporter-error-code.enum';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ImpactReportCronConsumer } from './impact-report-cron.consumer';

describe('ImpactReportCronConsumer', () => {
  const mockImpactUsecase = { execute: jest.fn() };
  const mockSlackNotifier = { postMessage: jest.fn() };
  const mockPublisher = { publishCronFailure: jest.fn(), publishClaudeAuthSuspect: jest.fn() };

  const consumer = new ImpactReportCronConsumer(
    mockImpactUsecase as never,
    mockSlackNotifier as never,
    mockPublisher as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('정상 — usecase 에 subject="--recent 7d" + triggerType=IMPACT_REPORT_RECENT_CRON 전달 + Slack 발송', async () => {
    mockImpactUsecase.execute.mockResolvedValue({
      result: {
        subject: 'JSL107 의 모든 repo 7일 (3건) 종합',
        headline: '머지 3건',
        quantitative: ['PR 3건', '+200 LOC'],
        qualitative: '주간 본인 contribution.',
        affectedAreas: { users: [], team: [], service: [] },
        beforeAfter: null,
        risks: [],
        reasoning: '...',
      },
      modelUsed: 'codex-cli',
      agentRunId: 42,
    });

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', days: 7 },
    } as never);

    expect(mockImpactUsecase.execute).toHaveBeenCalledWith({
      subject: '--recent 7d',
      slackUserId: 'U1',
      triggerType: 'IMPACT_REPORT_RECENT_CRON',
    });
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.target).toBe('C1');
    expect(call.text).toMatch(
      /📊 \*Impact Report — \d{4}-\d{2}-\d{2} \(최근 7일 자동 종합\)\*/,
    );
    expect(call.text).toContain('머지 3건');
  });

  it('RECENT_MODE_NO_RESULTS — graceful skip + 안내 메시지 (재시도 안 함)', async () => {
    mockImpactUsecase.execute.mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_NO_RESULTS,
        message: '최근 7일 머지 PR 0건',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', days: 7 },
    } as never);

    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.text).toMatch(/🪶 \*Impact Report — \d{4}-\d{2}-\d{2} skip\*/);
    expect(call.text).toContain('최근 7일 머지 PR 0건');
    expect(call.text).toContain('다음 주에 다시 시도');
  });

  it('RECENT_MODE_ENV_MISSING — env 누락 안내 Slack 발송 + propagate X', async () => {
    mockImpactUsecase.execute.mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_ENV_MISSING,
        message: 'env 누락',
        status: DomainStatus.BAD_REQUEST,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', days: 7 },
    } as never);

    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.text).toContain('env 누락');
    expect(call.text).toContain('IMPACT_REPORT_GITHUB_AUTHOR');
  });

  it('알 수 없는 에러는 그대로 propagate (BullMQ 재시도)', async () => {
    mockImpactUsecase.execute.mockRejectedValue(new Error('codex capacity'));

    await expect(
      consumer.process({
        data: { ownerSlackUserId: 'U1', target: 'C1', days: 7 },
      } as never),
    ).rejects.toThrow('codex capacity');
    expect(mockSlackNotifier.postMessage).not.toHaveBeenCalled();
    // throw 직전 NotificationQueue 로 publish — cron 운영자가 consumer 측에서 dedupe + Slack DM.
    expect(mockPublisher.publishCronFailure).toHaveBeenCalledWith({
      cronName: 'Impact Report Cron',
      ownerSlackUserId: 'U1',
      errorMessage: 'codex capacity',
    });
  });

  it('graceful skip (RECENT_MODE_NO_RESULTS) 케이스에서는 알람 미발사', async () => {
    mockImpactUsecase.execute.mockRejectedValue(
      new ImpactReporterException({
        code: ImpactReporterErrorCode.RECENT_MODE_NO_RESULTS,
        message: '최근 7일 머지 PR 0건',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1', days: 7 },
    } as never);

    expect(mockPublisher.publishCronFailure).not.toHaveBeenCalled();
  });
});
