import {
  MarketDataPrismaRepository,
  UniverseTicker,
} from '../../market-data/infrastructure/market-data.prisma.repository';
import { NaverInvestorFlowClient } from '../../market-data/infrastructure/naver/naver-investor-flow.client';
import { CollectInvestorFlowUsecase } from './collect-investor-flow.usecase';

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
    });
    expect(fetchRows).toHaveBeenCalledTimes(2);
  });
});
