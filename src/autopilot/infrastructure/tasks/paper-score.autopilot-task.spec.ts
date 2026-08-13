import { ConfigService } from '@nestjs/config';

import {
  ScoreRecommendationsResult,
  ScoreRecommendationsUsecase,
} from '../../../paper-trading/application/score-recommendations.usecase';
import { formatPaperScoreReport } from '../../../paper-trading/infrastructure/paper-score.formatter';
import { PaperScoreAutopilotTask } from './paper-score.autopilot-task';

const context = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-14' };

const SCORE_RESULT: ScoreRecommendationsResult = {
  asOf: new Date('2026-08-14T00:00:00.000Z'),
  from: null,
  accounts: [],
  classifications: { closed: 0, open: 0, expired: 0, anomaly: 0 },
  exclusions: {
    expired: 0,
    benchmarkUnavailable: 0,
    shadowUnavailable: 0,
    anomaly: 0,
    realizedPnlMismatch: 0,
  },
};

const createFixture = (enabled = 'true') => {
  const score = { execute: jest.fn().mockResolvedValue(SCORE_RESULT) };
  const config = { get: jest.fn().mockReturnValue(enabled) };
  return {
    task: new PaperScoreAutopilotTask(
      score as unknown as ScoreRecommendationsUsecase,
      config as unknown as ConfigService,
    ),
    score,
  };
};

describe('PaperScoreAutopilotTask', () => {
  it('PAPER_TRADING_ENABLED가 꺼져 있으면 채점하지 않고 skip한다', async () => {
    const { task, score } = createFixture('false');

    await expect(task.run(context)).resolves.toEqual({ skip: true });
    expect(score.execute).not.toHaveBeenCalled();
  });

  it('job의 KST 날짜를 UTC 날짜 경계로 고정해 같은 채점 리포트를 반환한다', async () => {
    const { task, score } = createFixture();

    await expect(task.run(context)).resolves.toEqual({
      skip: false,
      summaryText: formatPaperScoreReport(SCORE_RESULT),
    });
    expect(score.execute).toHaveBeenCalledWith({
      asOf: new Date('2026-08-14T00:00:00.000Z'),
    });
  });
});
