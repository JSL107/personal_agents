import { ConfigService } from '@nestjs/config';

import { BuildScreeningScorecardUsecase } from '../../../screener/application/build-screening-scorecard.usecase';
import { buildScorecardHorizon } from '../../../screener/domain/screening-scorecard';
import { AutopilotTaskContext } from '../../domain/autopilot-task.port';
import { ScreeningScorecardAutopilotTask } from './screening-scorecard.autopilot-task';

const context = { firedAtKst: '2026-08-31' } as AutopilotTaskContext;

const buildTask = (
  execute: jest.Mock,
  enabled = 'true',
): ScreeningScorecardAutopilotTask =>
  new ScreeningScorecardAutopilotTask(
    { execute } as unknown as BuildScreeningScorecardUsecase,
    { get: () => enabled } as unknown as ConfigService,
  );

const horizonWithSample = buildScorecardHorizon({
  horizonDays: 5,
  newlyScoredCount: 2,
  pendingRunCount: 12,
  rows: [
    {
      strategy: 'SWING',
      ruleVersion: 2,
      rank: 1,
      returnPct: 10,
      bought: true,
      tickerCode: '000000',
      tickerName: '테스트',
    },
    {
      strategy: 'SWING',
      ruleVersion: 2,
      rank: 2,
      returnPct: 4,
      bought: false,
      tickerCode: '000001',
      tickerName: '대조',
    },
  ],
});

const emptyHorizon = buildScorecardHorizon({
  horizonDays: 20,
  newlyScoredCount: 0,
  pendingRunCount: 14,
  rows: [],
});

describe('ScreeningScorecardAutopilotTask', () => {
  // 대조군 판정이 paper_order 에 의존하므로, 모의투자가 꺼져 있으면 "산 것" 이 전건 0 이
  // 되어 카드가 비교가 아니라 목록이 된다.
  it('모의투자 게이트가 꺼져 있으면 조회하지 않고 건너뛴다', async () => {
    const execute = jest.fn();

    const result = await buildTask(execute, 'false').run(context);

    expect(result).toEqual({ skip: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it('어느 지평에도 표본이 없으면 빈 카드를 보내지 않는다', async () => {
    const execute = jest.fn().mockResolvedValue({
      asOf: new Date('2026-08-31T00:00:00.000Z'),
      horizons: [emptyHorizon],
    });

    const result = await buildTask(execute).run(context);

    expect(result).toEqual({ skip: true });
  });

  // 한 지평에 표본이 있으면 표본 없는 지평도 함께 실려야 한다 — 그 축이 비었다는 사실이
  // 카드에서 사라지면 안 된다.
  it('표본이 있으면 요약과 스레드 상세를 함께 낸다', async () => {
    const execute = jest.fn().mockResolvedValue({
      asOf: new Date('2026-08-31T00:00:00.000Z'),
      horizons: [horizonWithSample, emptyHorizon],
    });

    const result = await buildTask(execute).run(context);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('*5거래일 지평* — 표본 2건');
    expect(result.summaryText).toContain(
      '*20거래일 지평* — 표본 없음 (채점 대기 회차 14건)',
    );
    expect(result.detailText).toContain('놓친 최고');
  });
});
