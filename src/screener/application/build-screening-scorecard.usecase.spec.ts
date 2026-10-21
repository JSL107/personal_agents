import { ScreeningScorecardRow } from '../domain/screening-scorecard';
import { ScreeningHistoryPrismaRepository } from '../infrastructure/screening-history.prisma.repository';
import { BuildScreeningScorecardUsecase } from './build-screening-scorecard.usecase';

const asOf = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

interface RepositoryStub {
  findScorecardRows: jest.Mock;
  countScoredBetween: jest.Mock;
  countRunsPendingOutcome: jest.Mock;
}

const buildStub = (): RepositoryStub => ({
  findScorecardRows: jest.fn().mockResolvedValue([]),
  countScoredBetween: jest.fn().mockResolvedValue(0),
  countRunsPendingOutcome: jest.fn().mockResolvedValue(0),
});

const buildUsecase = (stub: RepositoryStub): BuildScreeningScorecardUsecase =>
  new BuildScreeningScorecardUsecase(
    stub as unknown as ScreeningHistoryPrismaRepository,
  );

describe('BuildScreeningScorecardUsecase', () => {
  it('지평 둘을 표본 없이도 빠짐없이 낸다', async () => {
    const stub = buildStub();

    const result = await buildUsecase(stub).execute({
      asOf: asOf('2026-09-04'),
    });

    expect(result.horizons.map((horizon) => horizon.horizonDays)).toEqual([
      5, 20,
    ]);
    expect(stub.findScorecardRows).toHaveBeenCalledTimes(2);
    expect(stub.countRunsPendingOutcome).toHaveBeenCalledTimes(2);
  });

  // 하한을 `asOf - 7일` 로 두면 그 자리가 전주 금요일 자정이 되고, 채점은 평일 19:00 KST
  // (10:00 UTC) 에 도므로 전주 금요일 판정분이 전주 카드와 이번 주 카드 양쪽에 세어진다.
  it('신규 집계 창은 asOf 를 포함한 7일이고 양끝이 닫혀 있다', async () => {
    const stub = buildStub();

    await buildUsecase(stub).execute({ asOf: asOf('2026-09-04') });

    for (const call of stub.countScoredBetween.mock.calls) {
      const [, since, until] = call as [number, Date, Date];
      expect(since.toISOString()).toBe('2026-08-29T00:00:00.000Z');
      expect(until.toISOString()).toBe('2026-09-05T00:00:00.000Z');
    }
  });

  // 창이 겹치면 같은 판정이 두 주에 걸쳐 "신규" 로 세어져 실제 증가량과 달라진다.
  it('연속 두 회차의 창이 겹치지 않는다', async () => {
    const previous = buildStub();
    const current = buildStub();

    await buildUsecase(previous).execute({ asOf: asOf('2026-08-28') });
    await buildUsecase(current).execute({ asOf: asOf('2026-09-04') });

    const [, previousSince, previousUntil] = previous.countScoredBetween.mock
      .calls[0] as [number, Date, Date];
    const [, currentSince] = current.countScoredBetween.mock.calls[0] as [
      number,
      Date,
      Date,
    ];
    expect(previousUntil.getTime()).toBe(currentSince.getTime());

    // 전주 금요일 채점분(19:00 KST = 10:00 UTC)은 전주 창에만 든다.
    const previousFridayScoring = new Date('2026-08-28T10:00:00.000Z');
    expect(previousFridayScoring.getTime()).toBeGreaterThanOrEqual(
      previousSince.getTime(),
    );
    expect(previousFridayScoring.getTime()).toBeLessThan(
      previousUntil.getTime(),
    );
    expect(previousFridayScoring.getTime()).toBeLessThan(
      currentSince.getTime(),
    );
  });

  describe('findSelectionGap', () => {
    const scorecardRow = (input: {
      strategy: string;
      runId: number;
      bought: boolean;
      returnPct: number;
    }): ScreeningScorecardRow => ({
      ruleVersion: 7,
      rank: 1,
      presented: true,
      tickerCode: '005930',
      tickerName: '삼성전자',
      entryTradeDate: asOf('2026-10-01'),
      horizonTradeDate: asOf('2026-10-08'),
      runFullyStored: true,
      ...input,
    });

    it('기준 시점을 조회 상한으로 넘긴다 — look-ahead 차단', async () => {
      const stub = buildStub();

      await buildUsecase(stub).findSelectionGap({
        strategy: 'SWING',
        horizonDays: 5,
        asOfMax: asOf('2026-10-20'),
      });

      expect(stub.findScorecardRows).toHaveBeenCalledWith(5, {
        horizonTradeDateMax: asOf('2026-10-20'),
      });
    });

    it('요청한 전략의 회차별 격차만 꺼낸다', async () => {
      const stub = buildStub();
      stub.findScorecardRows.mockResolvedValue([
        scorecardRow({
          strategy: 'SWING',
          runId: 1,
          bought: true,
          returnPct: 3,
        }),
        scorecardRow({
          strategy: 'SWING',
          runId: 1,
          bought: false,
          returnPct: 1,
        }),
        scorecardRow({
          strategy: 'SWING',
          runId: 2,
          bought: true,
          returnPct: 0,
        }),
        scorecardRow({
          strategy: 'SWING',
          runId: 2,
          bought: false,
          returnPct: 4,
        }),
        scorecardRow({
          strategy: 'LONG_TERM',
          runId: 3,
          bought: true,
          returnPct: 9,
        }),
        scorecardRow({
          strategy: 'LONG_TERM',
          runId: 3,
          bought: false,
          returnPct: 0,
        }),
      ]);

      const result = await buildUsecase(stub).findSelectionGap({
        strategy: 'SWING',
        horizonDays: 5,
        asOfMax: asOf('2026-10-20'),
      });

      // 회차 1: +2, 회차 2: −4 → 평균 −1
      expect(result).toEqual({ horizonDays: 5, gapPct: -1, gapRunCount: 2 });
    });

    it('그 전략의 행이 없으면 격차 null · 회차 0 — 0%p 로 위장하지 않는다', async () => {
      const result = await buildUsecase(buildStub()).findSelectionGap({
        strategy: 'SWING',
        horizonDays: 5,
        asOfMax: asOf('2026-10-20'),
      });

      expect(result).toEqual({ horizonDays: 5, gapPct: null, gapRunCount: 0 });
    });
  });
});
