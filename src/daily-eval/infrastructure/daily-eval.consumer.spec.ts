import { PoEvalException } from '../../agent/po-eval/domain/po-eval.exception';
import { PoEvalErrorCode } from '../../agent/po-eval/domain/po-eval-error-code.enum';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { DailyEvalConsumer } from './daily-eval.consumer';

describe('DailyEvalConsumer', () => {
  const mockPoEvalUsecase = { execute: jest.fn() };
  const mockSlackNotifier = { postMessage: jest.fn() };
  const mockCronAlerter = { notifyCronFailure: jest.fn() };

  const consumer = new DailyEvalConsumer(
    mockPoEvalUsecase as never,
    mockSlackNotifier as never,
    mockCronAlerter as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockCronAlerter.notifyCronFailure.mockResolvedValue(undefined);
  });

  it('PoEval 정상 — Slack 발송 1회 + range=TODAY + DAILY_EVAL_CRON 트리거', async () => {
    mockPoEvalUsecase.execute.mockResolvedValue({
      result: {
        range: 'TODAY',
        sourceAgentRuns: { workReviewerRunId: 10 },
        qualitative: { summary: 'ok', blockers: [], wins: ['win 1'] },
        careerLog: {
          schemaVersion: 1,
          period: '2026-05-28',
          achievements: { quantitative: [], qualitative: [] },
          technologies: ['NestJS'],
          impact: '오늘 핵심 활동.',
        },
      },
      modelUsed: 'claude',
      agentRunId: 50,
    });

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as never);

    expect(mockPoEvalUsecase.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      range: 'TODAY',
      triggerType: 'DAILY_EVAL_CRON',
    });
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.target).toBe('C1');
    expect(call.text).toContain('PO 통합 평가');
    // V3 Daily Eval intro — 자동 회고 헤더 + KST 날짜 ISO 형식 + 19:00 KST 표시.
    expect(call.text).toMatch(
      /🌅 \*Daily Eval — \d{4}-\d{2}-\d{2} \(19:00 KST 자동 회고\)\*/,
    );
  });

  it('NO_SUB_AGENT_RUNS 면 graceful skip + 안내 메시지', async () => {
    mockPoEvalUsecase.execute.mockRejectedValue(
      new PoEvalException({
        code: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
        message: '최근 24시간 내 sub-agent run 없습니다.',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as never);

    expect(mockPoEvalUsecase.execute).toHaveBeenCalledTimes(1);
    expect(mockSlackNotifier.postMessage).toHaveBeenCalledTimes(1);
    const call = mockSlackNotifier.postMessage.mock.calls[0][0];
    expect(call.text).toContain('skip');
    // 날짜 + 내일 재시도 안내가 포함되어 사용자가 빈 회고 상태를 정확히 인지.
    expect(call.text).toMatch(/🌙 \*Daily Eval — \d{4}-\d{2}-\d{2} skip\*/);
    expect(call.text).toContain('내일 19:00 KST');
  });

  it('NO_SUB_AGENT_RUNS 외 다른 에러는 그대로 propagate (BullMQ 재시도)', async () => {
    mockPoEvalUsecase.execute.mockRejectedValue(new Error('codex capacity'));

    await expect(
      consumer.process({
        data: { ownerSlackUserId: 'U1', target: 'C1' },
      } as never),
    ).rejects.toThrow('codex capacity');
    expect(mockSlackNotifier.postMessage).not.toHaveBeenCalled();
    // throw 직전 owner DM 알람 발사 — cron 운영자가 즉시 인지.
    expect(mockCronAlerter.notifyCronFailure).toHaveBeenCalledWith({
      cronName: 'Daily Eval',
      ownerSlackUserId: 'U1',
      errorMessage: 'codex capacity',
    });
  });

  it('NO_SUB_AGENT_RUNS graceful skip 인 경우 알람 미발사', async () => {
    mockPoEvalUsecase.execute.mockRejectedValue(
      new PoEvalException({
        code: PoEvalErrorCode.NO_SUB_AGENT_RUNS,
        message: '최근 24시간 내 sub-agent run 없습니다.',
        status: DomainStatus.NOT_FOUND,
      }),
    );

    await consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'C1' },
    } as never);

    expect(mockCronAlerter.notifyCronFailure).not.toHaveBeenCalled();
  });
});
