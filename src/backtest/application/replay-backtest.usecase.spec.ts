import { Prisma } from '@prisma/client';

import { SCREENER_RULE_VERSION } from '../../screener/domain/screener-rule';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { InMemoryPaperLedger } from '../infrastructure/in-memory-paper-ledger';
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

const staleExitBandBars = (): Map<number, BacktestBar[]> => {
  const tickerBars = buildBars(
    (index) => (index === 213 ? (5000 + index * 32) * 1.1 : 5000 + index * 32),
    () => 200_000,
    (index, close) => (index === 213 ? null : close),
  ).filter((_, index) => index !== 214 && index !== 215);
  const calendarBars = [214, 215].map((index) => ({
    tradeDate: TRADE_DATES[index],
    open: 1,
    close: new Prisma.Decimal(1),
    adjClose: new Prisma.Decimal(1),
    volume: BigInt(1),
  }));
  return new Map([
    [11, tickerBars],
    [999, calendarBars],
  ]);
};

// 상위 종목이 대기 주문이라 자리를 못 쓰는 상황을 만들려면 후보가 정원(3종목)보다 많아야 한다.
const MANY_TICKERS: BacktestTicker[] = [1, 2, 3, 4, 5].map((order) => ({
  tickerId: 20 + order,
  code: `00001${order}`,
  name: `상승${order}`,
  krxMarket: 'KOSPI',
}));

// 기울기를 종목마다 달리해 점수 순위가 갈리게 한다. holidayIndexes 의 평일은 봉을 만들지
// 않아 휴장일이 된다 — 실제 DailyPrice 에 휴장일 행이 없는 것과 같다.
const manyTickerBars = (
  holidayIndexes: number[],
): Map<number, BacktestBar[]> => {
  const holidays = new Set(holidayIndexes);
  return new Map(
    MANY_TICKERS.map((ticker, order) => [
      ticker.tickerId,
      TRADE_DATES.flatMap((tradeDate, index) => {
        if (holidays.has(index)) {
          return [];
        }
        const price = 5000 + index * (32 - order * 2);
        return [
          {
            tradeDate,
            open: price,
            close: new Prisma.Decimal(price),
            adjClose: new Prisma.Decimal(price),
            volume: BigInt(200_000),
          },
        ];
      }),
    ]),
  );
};

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
  exitBand: null,
};

const commandWithExitBand = {
  ...command,
  seedAmount: '15000',
  weightPercent: 100,
  holdingTradeDays: 100,
  exitBand: { takeProfitPercent: 0.1, stopLossPercent: -99 },
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
    expect(result).toMatchObject({
      exitBand: null,
      exitBandSellCounts: { takeProfit: 0, stopLoss: 0 },
    });
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

  // 시가가 있어도 갭이 크면 주문 시점 수량을 살 현금이 없다. 이 경로는 체결 usecase 가
  // EXPIRED 를 돌려주고 원장 상태도 리포지토리가 EXPIRED 로 바꾼다. 상태가 PENDING 으로
  // 남으면 채점기가 이상으로 세므로 그 값까지 함께 확인한다.
  it('시가가 있어도 현금이 모자라면 만료로 세고 원장 상태까지 정리한다', async () => {
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(risingBars((_, close) => close * 10)),
    );

    const result = await usecase.execute({
      ...command,
      seedAmount: '30000',
      weightPercent: 100,
    });

    expect(result.metrics.expirationsByReason['현금 부족']).toBeGreaterThan(0);
    expect(result.missingOpenCount).toBe(0);
    expect(result.scores.every((score) => score.anomalyCount === 0)).toBe(true);
  });

  // 종료일 다음 평일에 체결될 주문은 재생이 끝나 영원히 PENDING 으로 남는다. 채점기가 이를
  // UNEXPECTED_ORDER_STATUS 로 세면 정상 구간에도 허위 이상과 부풀려진 주문 수가 찍힌다.
  it('재생 구간을 넘어 체결될 주문은 만들지 않는다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute(command);

    expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
    expect(result.scores.every((score) => score.anomalyCount === 0)).toBe(true);
  });

  // --weight 는 규칙을 바꿔 성적을 비교하기 위한 값이다. 운영 상수 20% 로 다시 깎이면
  // 30% 규칙을 요청해도 20% 만 매수하면서 30% 성적으로 표시된다.
  it('목표 비중을 20% 보다 크게 주면 그 비중으로 매수한다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute({ ...command, weightPercent: 40 });

    expect(result.metrics.maximumWeightPercent).toBeGreaterThan(30);
  });

  // 휴장일에도 추천은 돌지만 상위 종목은 이미 대기 주문이다. 그 자리를 다음 순위로 채우지
  // 않으면 연휴 뒤 정원을 넘겨 한꺼번에 체결되는 실전 현상이 백테스트에 나타나지 않는다.
  it('휴장일에 대기 주문이 쌓이면 다음 순위까지 주문해 개장일 동시 체결을 재현한다', async () => {
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(manyTickerBars([219]), MANY_TICKERS),
    );

    const result = await usecase.execute({
      ...command,
      from: dateText(TRADE_DATES[218]),
      to: dateText(TRADE_DATES[222]),
    });

    expect(result.metrics.maximumFillsInOneDay).toBeGreaterThan(
      command.maximumPositions,
    );
    expect(result.metrics.burstFillDayCount).toBeGreaterThan(0);
  });

  // 백테스트 원장은 채점기가 그대로 먹는 형태로 쌓인다. 규칙 버전이 빠지거나 엉뚱한 값이면
  // 실전 원장과 다른 자를 쓰게 되는데, 이 값은 결과 지표에 안 나타나 조용히 틀릴 수 있다.
  it('재생이 만든 주문에 그날 쓴 스크리너 규칙 버전을 남긴다', async () => {
    const recordOrder = jest.spyOn(
      InMemoryPaperLedger.prototype,
      'recordOrder',
    );
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute(command);

    expect(result.orderCount).toBeGreaterThan(0);
    expect(recordOrder).toHaveBeenCalled();
    expect(
      recordOrder.mock.calls.every(
        ([order]) => order.ruleVersion === SCREENER_RULE_VERSION,
      ),
    ).toBe(true);
    recordOrder.mockRestore();
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

  it('밴드를 켜면 보유일수 만기 전에 매도하고 끄면 매도하지 않는다', async () => {
    const resultWithExitBand = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute(commandWithExitBand);
    const resultWithoutExitBand = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute({ ...commandWithExitBand, exitBand: null });

    expect(resultWithExitBand.exitBandSellCounts.takeProfit).toBeGreaterThan(0);
    expect(
      resultWithExitBand.scores.some((score) => score.closedCount > 0),
    ).toBe(true);
    expect(resultWithoutExitBand.exitBandSellCounts).toEqual({
      takeProfit: 0,
      stopLoss: 0,
    });
    expect(
      resultWithoutExitBand.scores.every((score) => score.closedCount === 0),
    ).toBe(true);
  });

  it('밴드 매도 주문의 스크리너 규칙 버전은 null이다', async () => {
    const recordOrder = jest.spyOn(
      InMemoryPaperLedger.prototype,
      'recordOrder',
    );
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute({
      ...commandWithExitBand,
      holdingTradeDays: 1,
    });
    const orders = recordOrder.mock.calls.map(([order]) => order);
    const buyOrders = orders.filter((order) => order.side === 'BUY');
    const sellOrders = orders.filter((order) => order.side === 'SELL');
    const exitBandSellOrders = orders.filter(
      (order) => order.side === 'SELL' && order.ruleVersion === null,
    );

    expect(result.exitBandSellCounts.takeProfit).toBeGreaterThan(0);
    expect(buyOrders.length).toBeGreaterThan(0);
    expect(
      buyOrders.every((order) => order.ruleVersion === SCREENER_RULE_VERSION),
    ).toBe(true);
    expect(exitBandSellOrders).toHaveLength(
      result.exitBandSellCounts.takeProfit + result.exitBandSellCounts.stopLoss,
    );
    expect(sellOrders).toEqual(exitBandSellOrders);
    expect(orders.map((order) => order.id)).toEqual(
      Array.from({ length: orders.length }, (_, index) => index + 1),
    );
    recordOrder.mockRestore();
  });

  it('마지막 봉이 오늘보다 오래되면 밴드 매도를 반복 생성하지 않는다', async () => {
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(staleExitBandBars()),
    );

    const result = await usecase.execute({
      ...commandWithExitBand,
      from: dateText(TRADE_DATES[210]),
      to: dateText(TRADE_DATES[215]),
      holdingTradeDays: 1,
      exitBand: { takeProfitPercent: 5, stopLossPercent: -99 },
    });

    expect(result.exitBandSellCounts).toEqual({
      takeProfit: 1,
      stopLoss: 0,
    });
    expect(result.missingOpenCount).toBeGreaterThan(0);
  });

  it('밴드를 켜도 구간을 넘어 체결될 매도 주문은 만들지 않는다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const result = await usecase.execute({
      ...commandWithExitBand,
      to: dateText(TRADE_DATES[233]),
    });

    expect(result.exitBandSellCounts.takeProfit).toBeGreaterThan(0);
    expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
    expect(result.scores.every((score) => score.anomalyCount === 0)).toBe(true);
  });

  it('밴드를 켠 같은 인자로 두 번 돌리면 완전히 같은 결과가 나온다', async () => {
    const first = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute(commandWithExitBand);
    const second = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute(commandWithExitBand);

    expect(first.exitBandSellCounts.takeProfit).toBeGreaterThan(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
