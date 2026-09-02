import { Prisma } from '@prisma/client';

import { SCREENER_RULE_VERSION } from '../../screener/domain/screener-rule';
import { BacktestBar, BacktestTicker } from '../domain/backtest-bar.type';
import { BacktestPrismaRepository } from '../infrastructure/backtest.prisma.repository';
import { InMemoryPaperLedger } from '../infrastructure/in-memory-paper-ledger';
import {
  createReplayWindowCache,
  ReplayBacktestResult,
  ReplayBacktestUsecase,
} from './replay-backtest.usecase';

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

// 고가·저가를 따로 주지 않으면 진폭 0 인 봉(고가=저가=종가)이다. 그러면 장중 손절이
// 종가 밴드보다 먼저 걸리는 일이 없어 기존 기대값이 그대로 회귀 감시가 된다.
// lowAt 을 주면 그날 안에 손절선을 뚫는 봉을 만들 수 있다.
const buildBars = (
  priceAt: (index: number) => number,
  volumeAt: (index: number) => number,
  openAt?: (index: number, close: number) => number | null,
  lowAt?: (index: number, close: number) => number | null,
): BacktestBar[] =>
  TRADE_DATES.map((tradeDate, index) => {
    const price = priceAt(index);
    const low = lowAt ? lowAt(index, price) : price;
    return {
      tradeDate,
      open: openAt ? openAt(index, price) : price,
      close: new Prisma.Decimal(price),
      adjClose: new Prisma.Decimal(price),
      high: new Prisma.Decimal(price),
      low: low === null ? null : new Prisma.Decimal(low),
      volume: BigInt(volumeAt(index)),
    };
  });

const TICKERS: BacktestTicker[] = [
  {
    tickerId: 11,
    code: '000001',
    name: '꾸준상승',
    krxMarket: 'KOSPI',
    delistedAt: null,
  },
];

// 5,000 에서 완만히 오르는 정배열 종목. 거래대금 2e9 로 유동성 필터를 통과한다.
const risingBars = (
  openAt?: (index: number, close: number) => number | null,
  lowAt?: (index: number, close: number) => number | null,
): Map<number, BacktestBar[]> =>
  new Map([
    [
      11,
      buildBars(
        (index) => 5000 + index * 32,
        () => 200_000,
        openAt,
        lowAt,
      ),
    ],
  ]);

// SWING 은 `close > ma20` 에 더해 `volumeSurge >= 1.5` 를 요구한다. 거래량이 상수면
// surge 가 1.0 이라 SWING 후보가 0 건이 되고, 전략 축을 태우는 테스트가 아무것도
// 검증하지 못한 채 통과한다. 하루걸러 거래량을 띄우면 직전 20봉 평균이 400k 이고
// 그날은 700k 라 surge 가 1.75 다.
const swingPassingBars = (): Map<number, BacktestBar[]> =>
  new Map([
    [
      11,
      buildBars(
        (index) => 5000 + index * 32,
        (index) => (index % 2 === 0 ? 700_000 : 100_000),
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
    high: new Prisma.Decimal(1),
    low: new Prisma.Decimal(1),
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
  delistedAt: null,
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
            high: new Prisma.Decimal(price),
            low: new Prisma.Decimal(price),
            volume: BigInt(200_000),
          },
        ];
      }),
    ]),
  );
};

// 종가는 `manyTickerBars` 와 같게 두고 장중 진폭을 **기울기와 무관한 순서**로 준다.
// 종가→종가 변동성은 기울기가 정하고 Parkinson 변동성은 진폭이 정하므로, 두 축을 나란히
// 정렬하면 두 추정량이 같은 순위를 내 아무것도 검증하지 못한다(실제로 그렇게 만들었다가
// 테스트가 통과했다). 축을 어긋나게 두면 순위합이 갈려 매수 종목이 달라진다 —
// 배선이 끊기거나 추정량이 상수로 고정되면 두 결과가 같아져 아래 테스트가 깨진다.
const RANGE_SPREADS = [1.06, 1.02, 1.1, 1.04, 1.08];

const manyTickerBarsWithRange = (): Map<number, BacktestBar[]> =>
  new Map(
    MANY_TICKERS.map((ticker, order) => [
      ticker.tickerId,
      TRADE_DATES.map((tradeDate, index) => {
        const price = 5000 + index * (32 - order * 2);
        const spread = RANGE_SPREADS[order];
        return {
          tradeDate,
          open: price,
          close: new Prisma.Decimal(price),
          adjClose: new Prisma.Decimal(price),
          high: new Prisma.Decimal(price * spread),
          low: new Prisma.Decimal(price / spread),
          volume: BigInt(200_000),
        };
      }),
    ]),
  );

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
  maximumDailyGainPercent: Number.POSITIVE_INFINITY,
  maximumPositions: 3,
  weightPercent: 20,
  holdingTradeDays: 5,
  exitBand: null,
  delistingRecoveryRate: 1,
  volatilityEstimator: 'CLOSE_TO_CLOSE' as const,
  slippagePercent: 0,
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

  describe('보유 중 상장폐지', () => {
    // 폐지 종목을 유니버스에 들이면서 청산하지 않으면, 봉이 끊긴 보유가 마지막 종가로
    // 영원히 평가된다 — 생존 편향을 지우려다 손실만 빠지는 반대 편향이 생긴다.
    it('폐지일이 지나면 보유를 청산하고 건수와 대금을 남긴다', async () => {
      const delistedAt = TRADE_DATES[230];
      const usecase = new ReplayBacktestUsecase(
        repositoryOf(risingBars(), [{ ...TICKERS[0], delistedAt }]),
      );

      const result = await usecase.execute(command);

      expect(result.delistedLiquidation.count).toBe(1);
      expect(Number(result.delistedLiquidation.proceeds)).toBeGreaterThan(0);
      expect(result.delistingRecoveryRate).toBe(1);
    });

    it('폐지가 없으면 청산도 없다', async () => {
      const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

      const result = await usecase.execute(command);

      expect(result.delistedLiquidation).toEqual({ count: 0, proceeds: '0' });
    });

    it('회수율을 낮추면 청산 대금이 그만큼 줄어든다', async () => {
      const delistedAt = TRADE_DATES[230];
      const tickers = [{ ...TICKERS[0], delistedAt }];
      const full = await new ReplayBacktestUsecase(
        repositoryOf(risingBars(), tickers),
      ).execute(command);
      const halved = await new ReplayBacktestUsecase(
        repositoryOf(risingBars(), tickers),
      ).execute({ ...command, delistingRecoveryRate: 0.5 });

      expect(halved.delistedLiquidation.count).toBe(1);
      expect(Number(halved.delistedLiquidation.proceeds)).toBeCloseTo(
        Number(full.delistedLiquidation.proceeds) / 2,
        6,
      );
      // 회수를 덜 하면 최종 평가액도 낮아야 한다. 대금만 줄고 계좌가 그대로면
      // 청산이 장부에 반영되지 않았다는 뜻이다.
      expect(Number(halved.finalTotalValue)).toBeLessThan(
        Number(full.finalTotalValue),
      );
    });

    // 원장에는 주문과 거래가 남으므로 체결 통계에서 빠지면 주문 수와 체결 수가 어긋난다.
    it('청산도 체결이므로 주문 수와 체결·만료 수가 맞아떨어진다', async () => {
      const delistedAt = TRADE_DATES[230];
      const usecase = new ReplayBacktestUsecase(
        repositoryOf(risingBars(), [{ ...TICKERS[0], delistedAt }]),
      );

      const result = await usecase.execute(command);

      expect(result.delistedLiquidation.count).toBe(1);
      expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
    });

    // 폐지일에 봉이 남아 있으면(정리매매 마지막 날에 목록에서 빠지는 경우) 전 거래일 추천이
    // 체결되고 같은 날 되파는 왕복이 생긴다. buildCandidates 의 날짜 규칙과도 갈린다.
    // 첫 추천일(210) 직후를 폐지일로 잡아야 그 대기 주문이 폐지일에 걸린다 — 보유가 이미
    // 차 있으면 새 매수가 나가지 않아 이 경로 자체가 만들어지지 않는다.
    it('폐지일에 봉이 남아 있어도 대기 매수는 체결하지 않는다', async () => {
      const delistedAt = TRADE_DATES[211];
      const usecase = new ReplayBacktestUsecase(
        repositoryOf(risingBars(), [{ ...TICKERS[0], delistedAt }]),
      );

      const result = await usecase.execute(command);

      expect(result.metrics.expirationsByReason['상장폐지']).toBeGreaterThan(0);
      // 사지 않았으므로 청산할 보유도 없다. 왕복이 생기면 둘 다 1 이상이 된다.
      expect(result.delistedLiquidation.count).toBe(0);
      expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
      expect(result.invariantViolations).toEqual([]);
    });

    // 대기 매도가 남은 채 폐지되면 같은 보유를 두 번 파는 경로가 생길 수 있다. 하루 순서를
    // 체결 뒤·밴드 앞으로 둔 것이 그 방어선이고, 불변식이 그것을 지켜본다.
    it('대기 매도가 있는 상태로 폐지돼도 같은 보유를 두 번 팔지 않는다', async () => {
      const delistedAt = TRADE_DATES[230];
      const usecase = new ReplayBacktestUsecase(
        repositoryOf(risingBars(), [{ ...TICKERS[0], delistedAt }]),
      );

      const result = await usecase.execute(commandWithExitBand);

      expect(result.invariantViolations).toEqual([]);
      expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
    });

    // 폐지 마킹이 마지막 봉보다 이르면 봉 대조만으로는 못 막는다.
    it('이미 폐지된 종목은 봉이 남아 있어도 새로 사지 않는다', async () => {
      const delistedAt = TRADE_DATES[205];
      const usecase = new ReplayBacktestUsecase(
        repositoryOf(risingBars(), [{ ...TICKERS[0], delistedAt }]),
      );

      const result = await usecase.execute(command);

      expect(result.orderCount).toBe(0);
    });
  });

  // command fixture 에 값을 넣는 것만으로는 새 전달 경로가 살아 있는지 알 수 없다.
  // `risingBars` 는 매일 0.25~0.27% 씩 오르므로, 상한 0.1% 는 모든 후보를 걸러낸다.
  it('유한한 상한은 후보 선정을 실제로 바꾼다', async () => {
    const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

    const withoutCap = await usecase.execute(command);
    const withCap = await usecase.execute({
      ...command,
      maximumDailyGainPercent: 0.1,
    });

    expect(withoutCap.orderCount).toBeGreaterThan(0);
    expect(withCap.orderCount).toBe(0);
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

  it('저가가 손절선을 뚫으면 그날 안에 장중 손절로 팔고 종가 밴드까지 가지 않는다', async () => {
    // 시가를 종가보다 10% 높게 두면 매수 직후 평가 손익률이 -9% 대로 시작하고, 저가를
    // 종가의 80% 로 두면 그날 안에 손절선(-5%)을 뚫는다. 익절은 사실상 끈다(+999%).
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(
        risingBars(
          (_, close) => Math.round(close * 1.1),
          (_, close) => Math.round(close * 0.8),
        ),
      ),
    );

    const result = await usecase.execute({
      ...commandWithExitBand,
      exitBand: { takeProfitPercent: 999, stopLossPercent: -5 },
    });

    expect(result.intradayStopSellCount).toBeGreaterThan(0);
    // 같은 봉을 종가 밴드가 다시 잡지 않는다. 저가 <= 종가라 장중 판정이 항상 먼저다 —
    // 이 값이 0 이 아니면 같은 보유가 두 경로로 팔렸다는 뜻이다.
    expect(result.exitBandSellCounts.stopLoss).toBe(0);
    expect(result.scores.some((score) => score.closedCount > 0)).toBe(true);
    expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
  });

  // 포매터 테스트는 결과 객체에 값을 직접 주입하므로 이 집계의 회귀를 잡지 못한다
  // (PR #447 이대리 리뷰 지적). 여유폭이 판정 근거이므로 계산 자체를 여기서 지킨다.
  it('장중 손절 여유폭을 저가와 손절선의 차이로 집계한다', async () => {
    // 저가를 종가의 80% 로 두면 손절선(-5%)보다 훨씬 아래라 여유폭이 크게 나온다.
    // 여유폭은 `손절선 - 저가손익률` 이므로 **항상 양수**여야 한다.
    const result = await new ReplayBacktestUsecase(
      repositoryOf(
        risingBars(
          (_, close) => Math.round(close * 1.1),
          (_, close) => Math.round(close * 0.8),
        ),
      ),
    ).execute({
      ...commandWithExitBand,
      exitBand: { takeProfitPercent: 999, stopLossPercent: -5 },
    });

    const margin = result.intradayStopMargin;
    expect(result.intradayStopSellCount).toBeGreaterThan(0);
    expect(margin.meanPercent as number).toBeGreaterThan(0);
    expect(margin.minPercent as number).toBeGreaterThan(0);
    // 분포는 순서가 지켜져야 한다 — 뒤집히면 분위수 계산이 깨진 것이다.
    expect(margin.minPercent as number).toBeLessThanOrEqual(
      margin.p10Percent as number,
    );
    expect(margin.p10Percent as number).toBeLessThanOrEqual(
      margin.medianPercent as number,
    );
  });

  it('장중 손절이 없으면 여유폭은 0 이 아니라 값 없음이다', async () => {
    // 0 으로 내면 "여유 없이 발동했다" 와 구분되지 않는다.
    const result = await new ReplayBacktestUsecase(
      repositoryOf(risingBars()),
    ).execute(command);

    expect(result.intradayStopSellCount).toBe(0);
    expect(result.intradayStopMargin).toEqual({
      meanPercent: null,
      medianPercent: null,
      p10Percent: null,
      minPercent: null,
      gapDownCount: 0,
    });
  });

  // 체결가 규칙(`min(시가, 손절선)`) 자체는 도메인 단위 테스트가 지킨다. 여기서 보는 것은
  // **재생 루프가 그 함수에 실제 시가와 평단을 연결하는가** 다 — 시가를 넘기지 않고 손절선만
  // 쓰면 아래 두 회차가 같은 성적을 내고, 갭하락 구간의 낙관 편향이 그대로 성적이 된다.
  //
  // 두 회차는 **저가가 같다**(종가의 70%). 다른 것은 220일째 시가뿐이다. 갭하락 회차는 그날
  // 시가가 평단의 80% 라 손절선(-5%)보다 아래이므로 시가로 체결해야 하고, 대조 회차는 시가가
  // 종가와 같아 손절선으로 체결해야 한다.
  it('갭하락이면 손절선이 아니라 그날 시가로 체결한다', async () => {
    const replayWithOpenFactor = async (
      openFactor: number,
    ): Promise<ReplayBacktestResult> => {
      const usecase = new ReplayBacktestUsecase(
        repositoryOf(
          risingBars(
            (index, close) =>
              index === 220 ? Math.round(close * openFactor) : close,
            (index, close) => (index === 220 ? Math.round(close * 0.7) : close),
          ),
        ),
      );
      return usecase.execute({
        ...commandWithExitBand,
        exitBand: { takeProfitPercent: 999, stopLossPercent: -5 },
      });
    };

    const gapDown = await replayWithOpenFactor(0.8);
    const intraday = await replayWithOpenFactor(1);

    // 같은 저가라 두 회차 모두 같은 날 한 건이 발동한다. 발동 수가 다르면 아래 현금 비교가
    // 체결가 차이를 보는 것이 아니게 된다.
    expect(gapDown.intradayStopSellCount).toBe(1);
    expect(intraday.intradayStopSellCount).toBe(1);
    expect(gapDown.exitBandSellCounts.stopLoss).toBe(0);
    expect(intraday.exitBandSellCounts.stopLoss).toBe(0);

    // 시가가 낮은 쪽이 그만큼 적게 받아야 한다. 두 값이 같으면 시가가 체결가에 닿지 않은 것이다.
    expect(Number(gapDown.finalCashBalance)).toBeLessThan(
      Number(intraday.finalCashBalance),
    );

    // 갭하락 계수는 이 두 회차를 갈라야 한다 — 갈리지 않으면 "손절선보다 낮게 팔린 건"
    // 이 집계에서 보이지 않고, 재생이 보수적으로 처리한 몫을 읽을 수 없다.
    expect(gapDown.intradayStopMargin.gapDownCount).toBe(1);
    expect(intraday.intradayStopMargin.gapDownCount).toBe(0);
    // 여유폭은 같은 저가에서 나오므로 두 회차가 같다 — 체결가가 아니라 판정으로 재기 때문이다.
    expect(gapDown.intradayStopMargin.meanPercent).toBe(
      intraday.intradayStopMargin.meanPercent,
    );
  });

  it('저가를 모르는 봉은 종가 밴드가 손절을 잡는다', async () => {
    // 시가를 종가보다 10% 높게 두면 매수 체결 직후 평가 손익률이 -9% 대로 시작한다.
    // 익절은 사실상 끄고(+999%) 손절만 켜서 STOP_LOSS 경로만 태운다.
    //
    // 저가를 비운 것이 이 테스트의 조건이다. 저가가 있으면 종가가 손절선 아래인 날은
    // 저가도 반드시 아래라(저가 <= 종가) 장중 손절이 그날 먼저 팔아, 종가 밴드까지
    // 오지 않는다. 5년 재적재 밖 구간처럼 저가가 없는 봉에서 이 경로가 남는다.
    const usecase = new ReplayBacktestUsecase(
      repositoryOf(
        risingBars(
          (_, close) => Math.round(close * 1.1),
          () => null,
        ),
      ),
    );

    const result = await usecase.execute({
      ...commandWithExitBand,
      exitBand: { takeProfitPercent: 999, stopLossPercent: -5 },
    });

    expect(result.exitBandSellCounts.stopLoss).toBeGreaterThan(0);
    expect(result.exitBandSellCounts.takeProfit).toBe(0);
    // 주문이 생성만 되고 끝나지 않았음을 본다 — 매도가 체결돼 사이클이 종결됐다.
    expect(result.scores.some((score) => score.closedCount > 0)).toBe(true);
    expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
  });

  it('마지막 시세 뒤의 평일을 to 로 주면 체결되지 않을 밴드 매도를 만들지 않는다', async () => {
    // 봉을 TRADE_DATES[233] 까지만 두고 to 를 그 다음 평일로 준다. 평일 기준으로만 막으면
    // 234일 체결 예정 주문이 만들어지지만 그 날은 봉이 없어 영원히 PENDING 으로 남는다
    // (가드를 되돌리면 PENDING 1건이 남아 이 단언이 깨진다 — 실측으로 확인한 조합이다).
    const bars = risingBars();
    bars.set(11, (bars.get(11) as BacktestBar[]).slice(0, 234));
    const usecase = new ReplayBacktestUsecase(repositoryOf(bars));

    const result = await usecase.execute({
      ...commandWithExitBand,
      to: dateText(TRADE_DATES[234]),
    });

    expect(result.exitBandSellCounts.takeProfit).toBeGreaterThan(0);
    expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
    expect(result.scores.every((score) => score.anomalyCount === 0)).toBe(true);
  });

  it('무밴드에서도 마지막 시세 뒤의 평일을 to 로 주면 체결되지 않을 매수를 만들지 않는다', async () => {
    // 같은 가드가 밴드 매도와 추천 매수 양쪽에 걸린다. 5종목·보유 1거래일로 매일 회전시키면
    // 마지막 거래일에도 신규 매수 후보가 남아, 구가드로 되돌리면 PENDING 2건이 남는다.
    const bars = new Map<number, BacktestBar[]>();
    for (const [tickerId, tickerBars] of manyTickerBars([])) {
      bars.set(tickerId, tickerBars.slice(0, 234));
    }
    const usecase = new ReplayBacktestUsecase(repositoryOf(bars, MANY_TICKERS));

    const result = await usecase.execute({
      ...command,
      to: dateText(TRADE_DATES[234]),
      holdingTradeDays: 1,
    });

    expect(result.filledCount).toBeGreaterThan(0);
    expect(result.orderCount).toBe(result.filledCount + result.expiredCount);
  });

  // 손잡이가 죽어도 parser·domain·formatter 단위 테스트는 전부 통과한다. 재생이 실제로
  // 그 값을 써서 순위를 다르게 세우는지는 여기서만 잡힌다.
  it('변동성 추정량을 바꾸면 순위가 갈려 성적이 달라진다', async () => {
    const runWith = async (
      volatilityEstimator: 'CLOSE_TO_CLOSE' | 'PARKINSON',
    ): Promise<ReplayBacktestResult> =>
      new ReplayBacktestUsecase(
        repositoryOf(manyTickerBarsWithRange(), MANY_TICKERS),
      ).execute({ ...command, maximumPositions: 2, volatilityEstimator });

    const baseline = await runWith('CLOSE_TO_CLOSE');
    const parkinson = await runWith('PARKINSON');

    expect(baseline.volatilityEstimator).toBe('CLOSE_TO_CLOSE');
    expect(parkinson.volatilityEstimator).toBe('PARKINSON');
    expect(JSON.stringify(parkinson.scores)).not.toBe(
      JSON.stringify(baseline.scores),
    );
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

  // 슬리피지 손잡이는 "체결가가 x% 불리했다면 결론이 살아남나" 를 재는 수단이라,
  // 값을 올릴수록 성적이 나빠지지 않으면 그 측정이 통째로 무의미하다.
  describe('체결가 슬리피지', () => {
    // 재생의 체결 경로는 셋이다 — 시가 체결·장중 손절·폐지 청산. 한 경로만 빠져도 그 경로를
    // 많이 타는 조합이 슬리피지를 덜 물어 순위가 왜곡되므로, 시가 체결 말고 나머지 둘도 각각
    // 지킨다.
    it('폐지 청산 대금에도 걸린다', async () => {
      const tickers = [{ ...TICKERS[0], delistedAt: TRADE_DATES[230] }];
      const proceedsOf = async (slippagePercent: number): Promise<number> => {
        const result = await new ReplayBacktestUsecase(
          repositoryOf(risingBars(), tickers),
        ).execute({ ...command, slippagePercent });
        expect(result.delistedLiquidation.count).toBe(1);
        return Number(result.delistedLiquidation.proceeds);
      };

      const base = await proceedsOf(0);
      // 값이 작아야 한다. 매수 체결가가 눈에 띄게 오르면 살 수 있는 수량이 줄어 두 회차가
      // 다른 표본이 되고, 그러면 아래 비율이 매도 슬리피지가 아니라 수량 차이를 재게 된다.
      const slipped = await proceedsOf(0.001);

      // 정확히 (1−x) 배여야 한다. 1 이면 이 경로가 슬리피지를 안 문 것이다.
      expect(slipped / base).toBeCloseTo(0.99999, 8);
    });

    it('장중 손절이 걸리는 회차에서도 성적이 나빠진다', async () => {
      // 시가를 종가와 같게, 저가를 70% 로 두면 220일째 장중 손절이 한 건 발동한다.
      const resultOf = async (
        slippagePercent: number,
      ): Promise<ReplayBacktestResult> =>
        new ReplayBacktestUsecase(
          repositoryOf(
            risingBars(
              (_, close) => close,
              (index, close) =>
                index === 220 ? Math.round(close * 0.7) : close,
            ),
          ),
        ).execute({
          ...commandWithExitBand,
          exitBand: { takeProfitPercent: 999, stopLossPercent: -5 },
          slippagePercent,
        });

      const base = await resultOf(0);
      const slipped = await resultOf(1);

      // 발동 수가 같아야 두 회차가 같은 사건을 비교하는 것이 된다. 체결가만 밀고 판정가는
      // 그대로 두었으므로 이 값은 변하지 않아야 한다.
      expect(base.intradayStopSellCount).toBe(1);
      expect(slipped.intradayStopSellCount).toBe(1);
      // 갭하락 판별도 판정가로 해야 한다. 민 값으로 비교하면 비갭 손절도 `손절선 x (1−x%)`
      // 가 손절선보다 낮아 전건이 갭하락으로 집계된다(PR #448 codex 리뷰 지적). 이 회차는
      // 시가가 종가와 같은 비갭이므로 두 회차 모두 0 이어야 한다.
      expect(base.intradayStopMargin.gapDownCount).toBe(0);
      expect(slipped.intradayStopMargin.gapDownCount).toBe(0);
      expect(Number(slipped.finalTotalValue)).toBeLessThan(
        Number(base.finalTotalValue),
      );
      // 정직히 — 이 단언은 매수 체결가에도 반응하므로 장중 손절 경로만 고립시키지는
      // 못한다. 그 경로가 실제로 슬리피지를 문다는 증거는 실측 쪽에 있다: 슬리피지 0.2%
      // 회차에서 −0.2% 밴드가 붕괴하는데(익절 값이 성적에 안 닿고 종결이 3,703건으로 늘어남)
      // 그 밴드의 청산은 거의 전부 이 경로다.
      // docs/superpowers/specs/2026-09-02-slippage-breakeven-remeasurement.md
    });

    it('값을 올리면 최종 평가액이 낮아진다', async () => {
      const zero = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute(commandWithExitBand);
      const slipped = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute({ ...commandWithExitBand, slippagePercent: 1 });

      expect(zero.filledCount).toBeGreaterThan(0);
      expect(slipped.slippagePercent).toBe(1);
      expect(Number(slipped.finalTotalValue)).toBeLessThan(
        Number(zero.finalTotalValue),
      );
    });

    // 슬리피지는 후보 산출 뒤에서만 쓰이므로 캐시 정체성이 아니다. 그 전제가 깨지면
    // 탐색기가 값만 바꿔 이어 돌릴 때 앞 회차의 성적을 그대로 재사용하게 된다.
    it('한 캐시로 값만 바꿔 이어 돌려도 각각 단독으로 돌린 것과 같다', async () => {
      const slippedCommand = { ...commandWithExitBand, slippagePercent: 1 };
      const zeroAlone = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute(commandWithExitBand);
      const slippedAlone = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute(slippedCommand);

      const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));
      const cache = createReplayWindowCache(
        commandWithExitBand.from,
        commandWithExitBand.to,
        commandWithExitBand.volatilityEstimator,
      );
      const zero = await usecase.execute(commandWithExitBand, cache);
      const slipped = await usecase.execute(slippedCommand, cache);

      expect(JSON.stringify(zero)).toBe(JSON.stringify(zeroAlone));
      expect(JSON.stringify(slipped)).toBe(JSON.stringify(slippedAlone));
    });
  });

  // 탐색기가 창 하나를 수십 번 재생하려고 후보 산출을 나눠 쓴다. 그 재사용이 성적을
  // 조금이라도 바꾸면 탐색 결과 전체가 재생의 성적이 아니라 캐시의 성적이 된다.
  describe('창 캐시', () => {
    it('캐시를 껴도 캐시 없이 돌린 것과 완전히 같은 결과가 나온다', async () => {
      const withoutCache = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute(commandWithExitBand);
      const withCache = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute(
        commandWithExitBand,
        createReplayWindowCache(
          commandWithExitBand.from,
          commandWithExitBand.to,
          commandWithExitBand.volatilityEstimator,
        ),
      );

      expect(JSON.stringify(withCache)).toBe(JSON.stringify(withoutCache));
    });

    it('한 캐시로 다른 파라미터를 이어 돌려도 각각 단독으로 돌린 것과 같다', async () => {
      const bandlessAlone = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute(command);
      const bandedAlone = await new ReplayBacktestUsecase(
        repositoryOf(risingBars()),
      ).execute({ ...commandWithExitBand, from: command.from, to: command.to });

      const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));
      const cache = createReplayWindowCache(
        command.from,
        command.to,
        command.volatilityEstimator,
      );
      const banded = await usecase.execute(
        { ...commandWithExitBand, from: command.from, to: command.to },
        cache,
      );
      const bandless = await usecase.execute(command, cache);

      expect(JSON.stringify(banded)).toBe(JSON.stringify(bandedAlone));
      expect(JSON.stringify(bandless)).toBe(JSON.stringify(bandlessAlone));
    });

    it('두 전략이 한 캐시를 나눠 써도 각각 단독으로 돌린 것과 같다', async () => {
      // 탐색기는 창 하나의 캐시를 LONG_TERM·SWING 이 함께 쓴다. 후보 산출이 전략을
      // 인자로 받지 않아 지금은 안전하지만, 누가 그 함수에 전략을 들이면 이 경로가
      // 조용히 깨진다 — 그때 실패할 자리를 만들어 둔다.
      const swingCommand = { ...command, strategy: 'SWING' as const };
      const longTermAlone = await new ReplayBacktestUsecase(
        repositoryOf(swingPassingBars()),
      ).execute(command);
      const swingAlone = await new ReplayBacktestUsecase(
        repositoryOf(swingPassingBars()),
      ).execute(swingCommand);

      const repository = repositoryOf(swingPassingBars());
      const usecase = new ReplayBacktestUsecase(repository);
      const cache = createReplayWindowCache(
        command.from,
        command.to,
        command.volatilityEstimator,
      );
      const longTerm = await usecase.execute(command, cache);
      const swing = await usecase.execute(swingCommand, cache);

      // 두 전략이 실제로 주문을 내야 이 비교가 검증력을 갖는다. 0 건끼리 같은 것은
      // 캐시가 전략을 섞어도 통과한다.
      expect(swingAlone.orderCount).toBeGreaterThan(0);
      expect(longTermAlone.orderCount).toBeGreaterThan(0);
      expect(JSON.stringify(longTerm)).toBe(JSON.stringify(longTermAlone));
      expect(JSON.stringify(swing)).toBe(JSON.stringify(swingAlone));
      expect(repository.findUniverse).toHaveBeenCalledTimes(1);
    });

    it('캐시를 재사용하면 종목·봉 조회를 다시 하지 않는다', async () => {
      const repository = repositoryOf(risingBars());
      const usecase = new ReplayBacktestUsecase(repository);
      const cache = createReplayWindowCache(
        command.from,
        command.to,
        command.volatilityEstimator,
      );

      await usecase.execute(command, cache);
      await usecase.execute(command, cache);

      expect(repository.findUniverse).toHaveBeenCalledTimes(1);
      expect(repository.findBarsInRange).toHaveBeenCalledTimes(1);
      expect(repository.findBenchmarkCloses).toHaveBeenCalledTimes(1);
    });

    it('변동성 추정량이 다른 캐시를 넘기면 끊는다', async () => {
      // 추정량은 후보의 지표 자체를 바꿔 순위를 재편한다(바로 위 테스트가 그것을
      // 증명한다). 캐시가 그것을 정체성으로 안 들면 PARKINSON 회차가 CLOSE_TO_CLOSE
      // 후보를 조용히 재사용해, 손잡이를 돌려도 성적이 안 바뀌는 것처럼 보인다.
      const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

      await expect(
        usecase.execute(
          { ...command, volatilityEstimator: 'PARKINSON' },
          createReplayWindowCache(command.from, command.to, 'CLOSE_TO_CLOSE'),
        ),
      ).rejects.toThrow('재생 캐시가 다른 조건의 것입니다');
    });

    it('다른 구간의 캐시를 넘기면 조용히 쓰지 않고 끊는다', async () => {
      const usecase = new ReplayBacktestUsecase(repositoryOf(risingBars()));

      await expect(
        usecase.execute(
          command,
          createReplayWindowCache(
            command.from,
            dateText(TRADE_DATES[239]),
            command.volatilityEstimator,
          ),
        ),
      ).rejects.toThrow('재생 캐시가 다른 조건의 것입니다');
    });
  });
});
