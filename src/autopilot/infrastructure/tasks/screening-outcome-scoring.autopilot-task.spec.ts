import { ScoreScreeningOutcomesUsecase } from '../../../screener/application/score-screening-outcomes.usecase';
import { AutopilotTaskContext } from '../../domain/autopilot-task.port';
import { ScreeningOutcomeScoringAutopilotTask } from './screening-outcome-scoring.autopilot-task';

const context = {} as AutopilotTaskContext;

const buildTask = (execute: jest.Mock): ScreeningOutcomeScoringAutopilotTask =>
  new ScreeningOutcomeScoringAutopilotTask({
    execute,
  } as unknown as ScoreScreeningOutcomesUsecase);

describe('ScreeningOutcomeScoringAutopilotTask', () => {
  // 지평이 안 찬 날은 대상만 있고 채점이 0이다. 매 평일 "0건 채점" 을 보내면 카드가
  // 소음이 되고, 진짜 채점된 날이 그 안에 묻힌다.
  it('채점한 항목이 없으면 알리지 않고 건너뛴다', async () => {
    const execute = jest.fn().mockResolvedValue({
      totalScoredCount: 0,
      horizons: [
        {
          horizonDays: 5,
          attemptedCount: 40,
          scoredCount: 0,
          skipped: {
            NOT_DUE: 40,
            ENTRY_OPEN_MISSING: 0,
            ENTRY_PRICE_NOT_POSITIVE: 0,
          },
        },
      ],
    });

    const result = await buildTask(execute).run(context);

    expect(result).toEqual({ skip: true });
  });

  // 합계만 적으면 5거래일만 차고 20거래일은 한 번도 안 찬 상태가 성공으로 보인다.
  it('채점한 지평만 골라 건수와 함께 알린다', async () => {
    const execute = jest.fn().mockResolvedValue({
      totalScoredCount: 12,
      horizons: [
        {
          horizonDays: 5,
          attemptedCount: 20,
          scoredCount: 12,
          skipped: {
            NOT_DUE: 8,
            ENTRY_OPEN_MISSING: 0,
            ENTRY_PRICE_NOT_POSITIVE: 0,
          },
        },
        {
          horizonDays: 20,
          attemptedCount: 20,
          scoredCount: 0,
          skipped: {
            NOT_DUE: 20,
            ENTRY_OPEN_MISSING: 0,
            ENTRY_PRICE_NOT_POSITIVE: 0,
          },
        },
      ],
    });

    const result = await buildTask(execute).run(context);

    expect(result).toEqual({
      skip: false,
      summaryText: '스크리닝 사후 채점 — 5거래일 12건',
    });
  });
});
