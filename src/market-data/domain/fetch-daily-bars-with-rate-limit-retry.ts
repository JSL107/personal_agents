import { DailyBar } from './market-data.type';
import { MarketDataRateLimitError } from './market-data-rate-limit.error';
import { FetchDailyBarsOptions, MarketDataPort } from './port/market-data.port';

// 유니버스 수집(`collect-universe-prices.usecase.ts`)과 같은 회복 시간이다.
export const RATE_LIMIT_RETRY_DELAY_MS = 1_000;

// 한도 초과는 순간적인 몰림이라 잠깐 쉬면 대개 풀린다. 재시도 없이 실패로 적으면 장중 손절은
// 그 종목 판정을 다음 회차(5분 뒤)로 미루고, 시가 체결은 그 주문을 다음 회차로 넘긴다.
// 실측(2026-10-06~08): 장중 손절 한도 초과 5회차가 모두 보유 8~10종목 중 1건만 실패했다 — 몰림이 짧다는 뜻이다.
// 재시도는 한 번뿐이다. 두 번째도 한도 초과면 공급자 쪽 사정이라 호출부가 실패로 적게 둔다.
export const fetchDailyBarsWithRateLimitRetry = async (
  marketData: MarketDataPort,
  symbol: string,
  days: number,
  options?: FetchDailyBarsOptions,
): Promise<DailyBar[]> => {
  try {
    return await marketData.fetchDailyBars(symbol, days, options);
  } catch (error) {
    if (!(error instanceof MarketDataRateLimitError)) {
      throw error;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, RATE_LIMIT_RETRY_DELAY_MS);
    });
    return await marketData.fetchDailyBars(symbol, days, options);
  }
};
