import { ResumeCalibrationCronConsumer } from './resume-calibration-cron.consumer';

const CAL = {
  verdict: 'ok',
  aiSlopRisks: [],
  underQuantified: [],
  outdatedPhrasing: [],
  missingKeywords: [],
  actionItems: ['x'],
};

const makeConsumer = (opts: { hermesOk: boolean }) => {
  const calibrateResume = {
    execute: jest.fn().mockResolvedValue({
      result: CAL,
      modelUsed: 'claude-cli',
      agentRunId: 1,
    }),
  };
  const hermesRunner = {
    run: opts.hermesOk
      ? jest.fn().mockResolvedValue({ stdout: '2026 트렌드 요약', stderr: '' })
      : jest.fn().mockRejectedValue(new Error('hermes down')),
  };
  const slackNotifier = { postMessage: jest.fn().mockResolvedValue(undefined) };
  const cronIdempotency = { acquireOnce: jest.fn().mockResolvedValue(true) };
  const consumer = new ResumeCalibrationCronConsumer(
    calibrateResume as never,
    hermesRunner as never,
    slackNotifier as never,
    cronIdempotency as never,
  );
  return { consumer, calibrateResume, hermesRunner, slackNotifier };
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
});
