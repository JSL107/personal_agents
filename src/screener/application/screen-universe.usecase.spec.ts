import { DecimalValue } from '../../market-data/domain/market-data.type';
import { IndicatorBar } from '../../market-data/domain/stock-indicator';
import { MarketDataRepository } from '../../market-data/infrastructure/market-data.repository';
import { ScreenUniverseUsecase } from './screen-universe.usecase';

const decimal = (value: number): DecimalValue => ({
  toNumber: () => value,
  toString: () => String(value),
});

const risingBars = (count: number, endDate: string): IndicatorBar[] => {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: new Date(
      end.getTime() - (count - 1 - index) * 24 * 60 * 60 * 1_000,
    ),
    adjClose: decimal(index + 1),
    volume: index === count - 1 ? 300n : 100n,
  }));
};

describe('ScreenUniverseUsecase', () => {
  it('유니버스를 200종목씩 읽고 공통 기준일과 다른 종목을 제외해 집계한다', async () => {
    const tickers = Array.from({ length: 201 }, (_, index) => ({
      id: index + 1,
      code: String(index + 1).padStart(6, '0'),
      name: `종목${index + 1}`,
      tossSymbol: String(index + 1).padStart(6, '0'),
      krxMarket: 'KOSPI',
    }));
    const findBarsForTickers = jest
      .fn()
      .mockResolvedValueOnce(new Map([[1, risingBars(200, '2026-08-11')]]))
      .mockResolvedValueOnce(new Map([[201, risingBars(200, '2026-08-12')]]));
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue(tickers),
      findBarsForTickers,
    } as unknown as MarketDataRepository;
    const usecase = new ScreenUniverseUsecase(repository);

    const result = await usecase.execute({ strategy: 'LONG_TERM', limit: 1 });

    expect(findBarsForTickers).toHaveBeenNthCalledWith(
      1,
      tickers.slice(0, 200).map((ticker) => ticker.id),
      200,
    );
    expect(findBarsForTickers).toHaveBeenNthCalledWith(2, [201], 200);
    expect(result).toEqual({
      strategy: 'LONG_TERM',
      ruleVersion: 1,
      universeCount: 201,
      evaluatedCount: 2,
      staleCount: 1,
      passedCount: 1,
      stocks: [expect.objectContaining({ code: '000201' })],
      asOf: '2026-08-12',
    });
  });

  it('봉이 전혀 없으면 평가·통과 없이 asOf도 null이다', async () => {
    const repository = {
      findUniverseTickers: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: '005930',
          name: '삼성전자',
          tossSymbol: '005930',
          krxMarket: 'KOSPI',
        },
      ]),
      findBarsForTickers: jest.fn().mockResolvedValue(new Map()),
    } as unknown as MarketDataRepository;
    const usecase = new ScreenUniverseUsecase(repository);

    await expect(usecase.execute({ strategy: 'SWING' })).resolves.toEqual({
      strategy: 'SWING',
      ruleVersion: 1,
      universeCount: 1,
      evaluatedCount: 0,
      staleCount: 0,
      passedCount: 0,
      stocks: [],
      asOf: null,
    });
  });
});
