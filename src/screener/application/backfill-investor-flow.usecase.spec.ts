import { InvestorFlowRow } from '../../market-data/domain/investor-flow.type';
import {
  MarketDataPrismaRepository,
  UniverseTicker,
} from '../../market-data/infrastructure/market-data.prisma.repository';
import { NaverInvestorFlowClient } from '../../market-data/infrastructure/naver/naver-investor-flow.client';
import { BackfillInvestorFlowUsecase } from './backfill-investor-flow.usecase';

const ticker: UniverseTicker = {
  id: 1,
  code: '005930',
  name: '삼성전자',
  tossSymbol: '005930',
  krxMarket: 'KOSPI',
  sector: null,
};

const row = (date: string): InvestorFlowRow => ({
  tradeDate: new Date(`${date}T00:00:00.000Z`),
  foreignNetBuy: 1n,
  institutionNetBuy: 2n,
  flowVolume: 10n,
});

describe('BackfillInvestorFlowUsecase', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T03:00:00.000Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('이미 오래된 가격 행까지 수급이 있는 종목은 건너뛴다', async () => {
    const fetchRows = jest.fn();
    const usecase = new BackfillInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findInvestorFlowBackfillTickers: jest.fn().mockResolvedValue([ticker]),
        findOldestPriceFlowTargets: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [
                1,
                { tickerId: 1, oldestTradeDate: '2021-09-30', hasFlow: true },
              ],
            ]),
          ),
      } as unknown as MarketDataPrismaRepository,
    );

    await expect(usecase.execute({ years: 5 })).resolves.toMatchObject({
      skipped: 1,
      targetCount: 1,
    });
    expect(fetchRows).not.toHaveBeenCalled();
  });

  it('페이지 커서를 과거로 옮기고 기존 가격 행에만 저장한다', async () => {
    const fetchRows = jest
      .fn()
      .mockResolvedValueOnce([row('2026-09-29'), row('2024-09-01')])
      .mockResolvedValueOnce([row('2022-09-29'), row('2022-09-27')]);
    const updateInvestorFlow = jest.fn().mockResolvedValue(2);
    const usecase = new BackfillInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findInvestorFlowBackfillTickers: jest.fn().mockResolvedValue([ticker]),
        findOldestPriceFlowTargets: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [
                1,
                { tickerId: 1, oldestTradeDate: '2022-09-27', hasFlow: false },
              ],
            ]),
          ),
        updateInvestorFlow,
      } as unknown as MarketDataPrismaRepository,
    );

    const result = await usecase.execute({ years: 5 });

    expect(result).toMatchObject({ succeeded: 1, pagesFetched: 2, written: 4 });
    expect(fetchRows).toHaveBeenNthCalledWith(2, '005930', '2024-08-31');
  });

  // 2026-09-30 실측: 234030(싸이닉솔루션)은 마지막 페이지가 상장일(= 커서 당일) 한 행만 돌려줬는데,
  // 커서와 같은 날짜를 미진전으로 판정해 그 행을 저장하지 못하고 멈췄다.
  it('마지막 페이지가 커서 당일 한 행만 돌려줘도 저장하고 끝낸다', async () => {
    const fetchRows = jest
      .fn()
      .mockResolvedValueOnce([row('2025-07-10'), row('2025-07-08')])
      .mockResolvedValueOnce([row('2025-07-07')]);
    const updateInvestorFlow = jest.fn().mockResolvedValue(1);
    const usecase = new BackfillInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findInvestorFlowBackfillTickers: jest.fn().mockResolvedValue([ticker]),
        findOldestPriceFlowTargets: jest
          .fn()
          .mockResolvedValue(
            new Map([
              [
                1,
                { tickerId: 1, oldestTradeDate: '2025-07-07', hasFlow: false },
              ],
            ]),
          ),
        updateInvestorFlow,
      } as unknown as MarketDataPrismaRepository,
    );

    await expect(usecase.execute({ years: 5 })).resolves.toMatchObject({
      succeeded: 1,
      stalled: 0,
    });
    expect(fetchRows).toHaveBeenNthCalledWith(2, '005930', '2025-07-07');
    expect(updateInvestorFlow).toHaveBeenLastCalledWith(1, [row('2025-07-07')]);
  });

  it('직전 페이지보다 과거로 가지 못하면 stalled로 분류하고 다른 종목 실패와 분리한다', async () => {
    const fetchRows = jest
      .fn()
      .mockResolvedValueOnce([row('2026-09-30')])
      .mockResolvedValueOnce([row('2026-09-30')])
      .mockRejectedValueOnce(new Error('네트워크 오류'));
    const tickers = [ticker, { ...ticker, id: 2, code: '000001' }];
    const usecase = new BackfillInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findInvestorFlowBackfillTickers: jest.fn().mockResolvedValue(tickers),
        findOldestPriceFlowTargets: jest.fn().mockResolvedValue(
          new Map(
            tickers.map((item) => [
              item.id,
              {
                tickerId: item.id,
                oldestTradeDate: '2021-09-30',
                hasFlow: false,
              },
            ]),
          ),
        ),
        updateInvestorFlow: jest.fn(),
      } as unknown as MarketDataPrismaRepository,
    );

    await expect(usecase.execute({ years: 5 })).resolves.toMatchObject({
      stalled: 1,
      failed: 1,
      failures: ['000001: 네트워크 오류'],
    });
  });
});
