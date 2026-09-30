import {
  MarketDataPrismaRepository,
  UniverseTicker,
} from '../../market-data/infrastructure/market-data.prisma.repository';
import { NaverInvestorFlowClient } from '../../market-data/infrastructure/naver/naver-investor-flow.client';
import {
  CollectInvestorFlowUsecase,
  MAXIMUM_CONSECUTIVE_FAILURES,
} from './collect-investor-flow.usecase';

const ticker = (id: number): UniverseTicker => ({
  id,
  code: String(id).padStart(6, '0'),
  name: `종목${id}`,
  tossSymbol: String(id),
  krxMarket: 'KOSPI',
  sector: null,
});

describe('CollectInvestorFlowUsecase', () => {
  it('종목 하나의 호출 실패를 집계하고 다음 종목을 계속 처리한다', async () => {
    const fetchRows = jest
      .fn()
      .mockRejectedValueOnce(new Error('응답 실패'))
      .mockResolvedValueOnce([]);
    const updateInvestorFlow = jest.fn().mockResolvedValue(0);
    const usecase = new CollectInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findUniverseTickers: jest
          .fn()
          .mockResolvedValue([ticker(1), ticker(2)]),
        updateInvestorFlow,
      } as unknown as MarketDataPrismaRepository,
    );

    await expect(usecase.execute()).resolves.toEqual({
      targetCount: 2,
      succeeded: 1,
      failed: 1,
      written: 0,
      failures: ['000001: 응답 실패'],
      abortedCount: 0,
    });
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });

  // 네이버가 먹통이면 종목마다 10초 timeout 을 직렬로 기다려 2,600종목이면 약 7시간 스윕을 붙잡는다.
  it('연속 실패가 상한에 닿으면 나머지 종목을 부르지 않고 건너뛴 수를 남긴다', async () => {
    const fetchRows = jest.fn().mockRejectedValue(new Error('timeout'));
    const tickers = Array.from(
      { length: MAXIMUM_CONSECUTIVE_FAILURES + 5 },
      (_, index) => ticker(index + 1),
    );
    const usecase = new CollectInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findUniverseTickers: jest.fn().mockResolvedValue(tickers),
        updateInvestorFlow: jest.fn(),
      } as unknown as MarketDataPrismaRepository,
    );

    await expect(usecase.execute()).resolves.toMatchObject({
      targetCount: tickers.length,
      succeeded: 0,
      failed: MAXIMUM_CONSECUTIVE_FAILURES,
      abortedCount: 5,
    });
    expect(fetchRows).toHaveBeenCalledTimes(MAXIMUM_CONSECUTIVE_FAILURES);
  });

  it('중간에 성공하면 연속 실패 수를 다시 센다', async () => {
    const fetchRows = jest.fn();
    for (let index = 0; index < MAXIMUM_CONSECUTIVE_FAILURES - 1; index += 1) {
      fetchRows.mockRejectedValueOnce(new Error('timeout'));
    }
    fetchRows.mockResolvedValueOnce([]);
    for (let index = 0; index < MAXIMUM_CONSECUTIVE_FAILURES - 1; index += 1) {
      fetchRows.mockRejectedValueOnce(new Error('timeout'));
    }
    const tickers = Array.from(
      { length: MAXIMUM_CONSECUTIVE_FAILURES * 2 - 1 },
      (_, index) => ticker(index + 1),
    );
    const usecase = new CollectInvestorFlowUsecase(
      { fetchRows } as unknown as NaverInvestorFlowClient,
      {
        findUniverseTickers: jest.fn().mockResolvedValue(tickers),
        updateInvestorFlow: jest.fn().mockResolvedValue(0),
      } as unknown as MarketDataPrismaRepository,
    );

    await expect(usecase.execute()).resolves.toMatchObject({
      succeeded: 1,
      abortedCount: 0,
    });
    expect(fetchRows).toHaveBeenCalledTimes(tickers.length);
  });
});
