import { DailySeriesPoint } from '../../market-data/domain/market-data.type';
import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import { MINIMUM_TURNOVER } from '../domain/candidate-selection';
import { MINIMUM_BAR_COUNT } from '../domain/indicator';
import { RankCandidatesUsecase } from './rank-candidates.usecase';

// 종가 1,000원대 × 이 거래량이면 거래대금 하한 5억을 넘는다.
const LIQUID_VOLUME = MINIMUM_TURNOVER / 1_000;

const buildSeries = (closes: number[]): DailySeriesPoint[] =>
  closes.map((close, index) => ({
    tradeDate: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    close,
    adjClose: close,
    volume: LIQUID_VOLUME,
  }));

// 우상향 — isUptrend 가 참이 된다.
const risingCloses = Array.from(
  { length: MINIMUM_BAR_COUNT },
  (_, index) => 1_000 + index,
);
// 우하향 — isUptrend 가 거짓이 된다.
const fallingCloses = Array.from(
  { length: MINIMUM_BAR_COUNT },
  (_, index) => 1_000 + MINIMUM_BAR_COUNT - index,
);

describe('RankCandidatesUsecase', () => {
  it('유니버스 지표를 계산해 전략별 후보를 돌려준다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000001',
          name: '오름',
          tossSymbol: '000001',
          krxMarket: 'KOSPI',
        },
        {
          id: 2,
          code: '000002',
          name: '내림',
          tossSymbol: '000002',
          krxMarket: 'KOSDAQ',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(
        new Map([
          [1, buildSeries(risingCloses)],
          [2, buildSeries(fallingCloses)],
        ]),
      ),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute();

    expect(result.universeCount).toBe(2);
    expect(result.evaluatedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    // 하락 종목은 isUptrend 가 거짓이라 장투 후보에서 빠진다.
    expect(result.longTerm.map((candidate) => candidate.code)).toEqual([
      '000001',
    ]);
    expect(result.longTerm[0].name).toBe('오름');
    expect(result.longTerm[0].krxMarket).toBe('KOSPI');
  });

  it('봉이 모자란 종목은 평가에서 빼고 건수로 남긴다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000001',
          name: '오름',
          tossSymbol: '000001',
          krxMarket: 'KOSPI',
        },
        {
          id: 2,
          code: '000002',
          name: '신규',
          tossSymbol: '000002',
          krxMarket: 'KOSDAQ',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(
        new Map([
          [1, buildSeries(risingCloses)],
          [2, buildSeries(risingCloses.slice(0, 10))],
        ]),
      ),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute();

    expect(result.evaluatedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
  });

  it('시세가 아예 없는 종목도 건너뛴다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '000001',
          name: '없음',
          tossSymbol: '000001',
          krxMarket: 'KOSPI',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute();

    expect(result.evaluatedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.longTerm).toEqual([]);
    expect(result.swing).toEqual([]);
  });

  it('limit 을 주면 전략별 후보 수를 제한한다', async () => {
    const tickers = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      code: String(index + 1).padStart(6, '0'),
      name: `종목${index}`,
      tossSymbol: String(index + 1).padStart(6, '0'),
      krxMarket: 'KOSPI',
    }));
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(tickers),
      findDailySeries: jest
        .fn()
        .mockResolvedValue(
          new Map(
            tickers.map((ticker) => [ticker.id, buildSeries(risingCloses)]),
          ),
        ),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    const result = await usecase.execute({ limit: 2 });

    expect(result.longTerm).toHaveLength(2);
    expect(result.swing).toHaveLength(2);
  });

  it('유니버스 전체 id 로 시계열을 조회한다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 7,
          code: '000007',
          name: '칠',
          tossSymbol: '000007',
          krxMarket: 'KOSPI',
        },
      ]),
      findDailySeries: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataRepository;
    const usecase = new RankCandidatesUsecase(repository);

    await usecase.execute();

    expect(repository.findDailySeries).toHaveBeenCalledWith([7], 200);
  });
});
