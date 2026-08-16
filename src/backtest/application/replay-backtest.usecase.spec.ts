import { Prisma } from '@prisma/client';

import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { ReplayBacktestUsecase } from './replay-backtest.usecase';

const BAR_COUNT = 240;

// 실제 DailyPrice 에는 휴장일 행이 없으므로 합성 봉도 평일만 만든다.
// 주말이 섞이면 재생 달력의 두 축(추천=평일 / 체결=거래일)이 검증되지 않는다.
const weekdayDates = (count: number): Date[] => {
  const dates: Date[] = [];
  const cursor = new Date(Date.UTC(2026, 0, 1));
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(new Date(cursor.getTime()));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
};

const TRADE_DATES = weekdayDates(BAR_COUNT);
const dateText = (value: Date): string => value.toISOString().slice(0, 10);

const buildBars = (
  priceAt: (index: number) => number,
  volumeAt: (index: number) => number,
  openAt?: (index: number, close: number) => number | null,
): BacktestBar[] =>
  TRADE_DATES.map((tradeDate, index) => {
    const price = priceAt(index);
    return {
      tradeDate,
      open: openAt ? openAt(index, price) : price,
      close: new Prisma.Decimal(price),
      adjClose: new Prisma.Decimal(price),
      volume: BigInt(volumeAt(index)),
    };
  });

const TICKERS: BacktestTicker[] = [
  { tickerId: 11, code: '000001', name: '꾸준상승', krxMarket: 'KOSPI' },
];

// 5,000 에서 완만히 오르는 정배열 종목. 거래대금 2e9 로 유동성 필터를 통과한다.
const risingBars = (
  openAt?: (index: number, close: number) => number | null,
): Map<number, BacktestBar[]> =>
  new Map([
    [
      11,
      buildBars(
        (index) => 5000 + index * 32,
        () => 200_000,
        openAt,
      ),
    ],
  ]);

const repositoryOf = (
  bars: Map<number, BacktestBar[]>,
  tickers: BacktestTicker[] = TICKERS,
): BacktestPrismaRepository =>
  ({
    findUniverse: jest.fn().mockResolvedValue(tickers),
    findBarsInRange: jest.fn().mockResolvedValue(bars),
    findBenchmarkCloses: jest.fn().mockResolvedValue([]),
  }) as unknown as BacktestPrismaRepository;

// 지표가 충분히 데워진 구간을 쓴다. ma120 과 200일 고점이 계산되려면 앞선 봉이 필요하다.
const FROM = dateText(TRADE_DATES[210]);
const TO = dateText(TRADE_DATES[235]);

const command = {
  strategy: 'LONG_TERM' as const,
  from: FROM,
  to: TO,
  seedAmount: '10000000',
  minimumTurnover60: 5e8,
  maximumPositions: 3,
  weightPercent: 20,
  holdingTradeDays: 5,
};

describe('ReplayBacktestUsecase', () => {
  it('구간을 재생해 체결과 성적을 낸다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute(command);

    expect(result.filledCount).toBeGreaterThan(0);
    expect(result.orderCount).toBeGreaterThan(0);
    expect(result.invariantViolations).toEqual([]);
    expect(result.finalTotalValue).not.toBeNull();
    expect(result.tradeDateCount).toBeGreaterThan(0);
  });

  it('같은 인자로 두 번 돌리면 완전히 같은 결과가 나온다', async () => {
    const first = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute(command);
    const second = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute(command);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('시가가 없는 거래일은 조용히 넘기지 않고 실패로 센다', async () => {
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(risingBars(() => null)),
    );

    const result = await usecase.execute(command);

    expect(result.filledCount).toBe(0);
    expect(result.missingOpenCount).toBeGreaterThan(0);
  });

  // 주문 수량은 전일 종가로 확정되고 체결은 다음날 시가라, 갭 상승분이 그대로 초과 편입된다.
  // 2026-08-16 검증에서 실측한 결함이며 백테스트가 이것을 상시 감시해야 한다.
  it('갭 상승으로 목표 비중을 넘겨 체결되면 지표가 잡아낸다', async () => {
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(risingBars((_, close) => close * 1.5)),
    );

    const result = await usecase.execute(command);

    expect(result.metrics.weightExceededCount).toBeGreaterThan(0);
    expect(result.metrics.maximumWeightPercent).toBeGreaterThan(20);
  });

  it('유니버스가 비면 주문 없이 끝난다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(new Map(), []));

    const result = await usecase.execute({ ...command, from: FROM, to: TO });

    expect(result.orderCount).toBe(0);
    expect(result.filledCount).toBe(0);
    expect(result.tradeDateCount).toBe(0);
    expect(result.invariantViolations).toEqual([]);
  });

  it('보유일수가 차면 청산해 실현손익이 남는다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute({
      ...command,
      from: dateText(TRADE_DATES[200]),
      to: dateText(TRADE_DATES[239]),
      holdingTradeDays: 3,
    });

    expect(result.scores.length).toBeGreaterThan(0);
    expect(result.scores[0].closedCount).toBeGreaterThan(0);
  });
});
