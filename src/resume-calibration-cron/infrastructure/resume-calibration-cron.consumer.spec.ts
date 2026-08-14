import { ResumeCalibrationCronConsumer } from './resume-calibration-cron.consumer';

const CAL = {
  verdict: 'ok',
  aiSlopRisks: [],
  underQuantified: [],
  outdatedPhrasing: [],
  missingKeywords: [],
  actionItems: ['x'],
};

const makeConsumer = (opts: { hermesOk: boolean; cal?: unknown }) => {
  const calibrateResume = {
    execute: jest.fn().mockResolvedValue({
      result: opts.cal ?? CAL,
      modelUsed: 'claude-cli',
      agentRunId: 1,
    }),
  };
  const hermesRunner = {
    run: opts.hermesOk
      ? jest.fn().mockResolvedValue({ stdout: '2026 트렌드 요약', stderr: '' })
      : jest.fn().mockRejectedValue(new Error('hermes down')),
  };
  const slackNotifier = {
    postMessage: jest.fn().mockResolvedValue({ ts: 'T1' }),
  };
  // 실제 가드처럼 키를 기억한다 — 같은 키의 두 번째 획득은 false.
  // (mock 이 항상 true 면 키에 무엇이 들어가든 테스트가 통과해 결함을 못 잡는다.)
  const acquired = new Set<string>();
  const cronIdempotency = {
    acquireOnce: jest.fn(async (key: string) => {
      if (acquired.has(key)) {
        return false;
      }
      acquired.add(key);
      return true;
    }),
  };
  // 윤문 no-op mock — 입력 필드를 그대로 반환(원본 유지). best-effort 윤문은 발송 흐름과 독립.
  const humanizeService = {
    humanize: jest.fn(async (fields: Record<string, string>) => fields),
  };
  const consumer = new ResumeCalibrationCronConsumer(
    calibrateResume as never,
    humanizeService as never,
    hermesRunner as never,
    slackNotifier as never,
    cronIdempotency as never,
  );
  return {
    consumer,
    calibrateResume,
    hermesRunner,
    slackNotifier,
    cronIdempotency,
  };
};

describe('ResumeCalibrationCronConsumer', () => {
  it('Hermes 성공 시 webTrendsNote 를 calibrate 에 전달하고 Slack 발송', async () => {
    const deps = makeConsumer({ hermesOk: true });
    await deps.consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'U1' },
    } as never);
    expect(deps.calibrateResume.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      webTrendsNote: '2026 트렌드 요약',
    });
    expect(deps.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
  });

  it('owner 가 다르면 같은 날에도 각각 발송된다 (가드 키에 owner 포함)', async () => {
    const deps = makeConsumer({ hermesOk: true });

    await deps.consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'U1' },
    } as never);
    await deps.consumer.process({
      data: { ownerSlackUserId: 'U2', target: 'U2' },
    } as never);

    expect(deps.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
    const keys = deps.cronIdempotency.acquireOnce.mock.calls.map(
      (call) => call[0],
    );
    expect(keys[0]).toContain(':U1:');
    expect(keys[1]).toContain(':U2:');
  });

  it('Hermes 실패해도 graceful — webTrendsNote undefined 로 진행', async () => {
    const deps = makeConsumer({ hermesOk: false });
    await deps.consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'U1' },
    } as never);
    expect(deps.calibrateResume.execute).toHaveBeenCalledWith({
      slackUserId: 'U1',
      webTrendsNote: undefined,
    });
    expect(deps.slackNotifier.postMessage).toHaveBeenCalledTimes(1);
  });

  it('요약이 잘리면 전체를 스레드 상세로 이어 붙인다(2회 발송)', async () => {
    const bigCal = {
      verdict: 'ok',
      aiSlopRisks: [],
      underQuantified: ['u1', 'u2', 'u3', 'u4', 'u5'],
      outdatedPhrasing: [],
      missingKeywords: [],
      actionItems: ['a1'],
    };
    const deps = makeConsumer({ hermesOk: true, cal: bigCal });
    await deps.consumer.process({
      data: { ownerSlackUserId: 'U1', target: 'U1' },
    } as never);
    expect(deps.slackNotifier.postMessage).toHaveBeenCalledTimes(2);
    // 두 번째 발송은 첫 메시지 ts 로 스레드 댓글(전체 리포트).
    const secondCall = deps.slackNotifier.postMessage.mock.calls[1][0];
    expect(secondCall.threadTs).toBe('T1');
    expect(secondCall.text).toContain('u5'); // 요약에서 접힌 항목이 전체엔 포함
  });
});
