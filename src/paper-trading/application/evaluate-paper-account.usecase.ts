import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  DailyBar,
  MoneyValue,
} from '../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import {
  describeSuspiciousPriceJump,
  detectSuspiciousPriceJump,
} from '../domain/corporate-action-guard';
import { verifyPaperInvariants } from '../domain/paper-invariant';
import {
  calculateAccountValuation,
  calculatePositionValuation,
  calculateUnsettledCash,
} from '../domain/paper-valuation';
import {
  InvariantCorporateActionRow,
  InvariantTradeRow,
  PaperPositionWithTicker,
  PaperTradingPrismaRepository,
} from '../infrastructure/paper-trading.prisma.repository';

export interface EvaluateAccountCommand {
  accountName: string;
  executedAt: Date;
}

export interface EvaluatedPositionRow {
  tickerId: number;
  tickerCode: string;
  tickerName: string;
  quantity: string;
  avgPrice: string;
  price: string;
  priceDate: string;
  marketValue: string;
  unrealizedPnl: string;
  returnRate: string;
  isStale: boolean;
}

export interface UnpricedPositionRow {
  tickerId: number;
  tickerCode: string;
  tickerName: string;
  quantity: string;
  avgPrice: string;
}

export interface EvaluateAccountResult {
  skipped: boolean;
  skipReason?: string;
  tradeDate: string | null;
  cashBalance: string;
  settledCash: string;
  unsettledCash: string;
  dividendNetTotal: string;
  dividendCount?: number;
  positionValue: string | null;
  totalValue: string | null;
  returnRate: string | null;
  // 총 수익률을 "이미 확정한 손익" 과 "아직 들고 있는 손익" 으로 가른 값. 카드가 보유
  // 종목만 보여주면 매도로 확정된 손실이 어디에도 드러나지 않는다.
  //
  // realizedPnl 은 `총평가 − 시드 − 평가손익` 으로 역산한 값이라 **배당까지 흡수한다**.
  // 그대로 "확정 손익" 이라 부르면 종목을 골라 번 돈과 배당으로 들어온 돈이 한 숫자에
  // 뭉쳐, 이 계좌의 목적인 추천 채점을 할 수 없다. 매매분만 따로 낸다.
  realizedPnl: string | null;
  tradingRealizedPnl?: string | null;
  unrealizedPnl: string | null;
  // 전 거래일 스냅샷의 수익률. 카드는 그날 상태만 찍으므로 나아졌는지 나빠졌는지가
  // 드러나지 않는다. 스냅샷이 없는 첫날에는 null 이다.
  previousReturnRate?: string | null;
  previousTradeDate?: string | null;
  benchmarkClose: string | null;
  positions: EvaluatedPositionRow[];
  unpricedPositions: UnpricedPositionRow[];
  positionCount: number;
  staleTickerCount: number;
  invariantViolations: string[];
  suspiciousJumps: string[];
}

export interface EvaluatedAccountEntry {
  accountName: string;
  // 계좌 하나가 예외로 끝나도 나머지 계좌는 평가해야 하므로, 결과 대신 사유를 싣는다.
  evaluation: EvaluateAccountResult | null;
  failureReason: string | null;
}

export interface EvaluateAllAccountsResult {
  accounts: EvaluatedAccountEntry[];
}

interface PositionPrice {
  position: PaperPositionWithTicker;
  bars: DailyBar[];
  latest: DailyBar;
}

interface CashSettlementSummary {
  settledCash: string;
  unsettledCash: string;
  dividendNetTotal: string;
  dividendCount: number;
}

const emptyCashSettlementSummary = (
  cashBalance: string,
): CashSettlementSummary => ({
  settledCash: cashBalance,
  unsettledCash: '0',
  dividendNetTotal: '0',
  dividendCount: 0,
});

const calculateCashSettlementSummary = (input: {
  cashBalance: MoneyValue;
  tradeDate: Date;
  trades: InvariantTradeRow[];
  corporateActions: InvariantCorporateActionRow[];
}): CashSettlementSummary => {
  const unsettledCash = calculateUnsettledCash({
    asOf: input.tradeDate,
    zero: input.cashBalance.times(0),
    trades: input.trades,
  });
  const dividendActions = input.corporateActions.filter(
    (corporateAction) => corporateAction.kind === 'DIVIDEND',
  );
  const dividendNetTotal = dividendActions.reduce(
    (total, corporateAction) => total.plus(corporateAction.cashDelta),
    input.cashBalance.times(0),
  );
  return {
    settledCash: input.cashBalance.minus(unsettledCash).toString(),
    unsettledCash: unsettledCash.toString(),
    dividendNetTotal: dividendNetTotal.toString(),
    dividendCount: dividendActions.length,
  };
};

const buildEvaluatedPositionRows = (
  pricedPositions: PositionPrice[],
  tradeDate: Date,
): EvaluatedPositionRow[] =>
  pricedPositions.map(({ position, latest }) => {
    const valuation = calculatePositionValuation(
      {
        tickerId: position.tickerId,
        quantity: position.quantity,
        avgPrice: position.avgPrice,
        price: new Prisma.Decimal(latest.close.toString()),
        priceDate: latest.tradeDate,
      },
      tradeDate,
    );
    return {
      tickerId: position.tickerId,
      tickerCode: position.ticker.code,
      tickerName: position.ticker.name,
      quantity: position.quantity.toString(),
      avgPrice: position.avgPrice.toString(),
      price: latest.close.toString(),
      priceDate: dateText(latest.tradeDate),
      marketValue: valuation.marketValue,
      unrealizedPnl: valuation.unrealizedPnl,
      returnRate: valuation.returnRate,
      isStale: valuation.isStale,
    };
  });

const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;

const formatKstTradeDate = (date: Date): string =>
  new Date(date.getTime() + KST_OFFSET_MILLISECONDS).toISOString().slice(0, 10);

const toDateOnly = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const dateText = (value: Date): string => value.toISOString().slice(0, 10);

const sortBars = (bars: DailyBar[]): DailyBar[] =>
  [...bars].sort(
    (left, right) => left.tradeDate.getTime() - right.tradeDate.getTime(),
  );

@Injectable()
export class EvaluatePaperAccountUsecase {
  constructor(
    private readonly repository: PaperTradingPrismaRepository,
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
  ) {}

  // 계좌 이름은 추천(PAPER_RECOMMEND)이 전략명으로 열기 때문에(LONG_TERM / SWING) 평가 쪽이
  // 이름을 알고 있으면 전략이 늘거나 바뀔 때 조용히 빠진다 — 실제로 평가는 1단계의 DEFAULT
  // 계좌만 보고 있어서, 추천이 실제로 매매하는 계좌의 스냅샷이 한 건도 적재되지 않았다.
  // findAllAccounts 로 전체를 훑어 이름 규칙을 아는 쪽을 repository 한 곳으로 남긴다.
  async executeAll(executedAt: Date): Promise<EvaluateAllAccountsResult> {
    const accounts = await this.repository.findAllAccounts();
    const entries: EvaluatedAccountEntry[] = [];
    // 계좌를 병렬로 평가하면 execute 안에서 종목별로 순차 조회한 이유(시세 rate limit 경쟁과
    // HTTP 429 회피)가 계좌 수만큼 무의미해지므로 계좌도 순차로 돈다.
    for (const account of accounts) {
      try {
        entries.push({
          accountName: account.name,
          evaluation: await this.execute({
            accountName: account.name,
            executedAt,
          }),
          failureReason: null,
        });
      } catch (error: unknown) {
        entries.push({
          accountName: account.name,
          evaluation: null,
          failureReason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { accounts: entries };
  }

  async execute(
    command: EvaluateAccountCommand,
  ): Promise<EvaluateAccountResult> {
    const account = await this.repository.findAccountByName(
      command.accountName,
    );
    if (!account) {
      throw new Error(
        `가상 매매 계좌를 찾을 수 없습니다: ${command.accountName}`,
      );
    }
    const tradeDateText = formatKstTradeDate(command.executedAt);
    const tradeDate = toDateOnly(tradeDateText);
    // 전 거래일 성적. 스냅샷은 그날 상태만 찍으므로 이 값이 없으면 카드만 보고는
    // 나아졌는지 나빠졌는지 알 수 없다. 계좌 락 밖에서 읽는다 — 읽기 전용이고
    // 락 안에서 다시 읽어도 같은 과거 행이라 락 시간만 길어진다.
    const previousSnapshot = await this.repository.findLatestSnapshotBefore(
      account.id,
      tradeDate,
    );
    const positions = await this.repository.findPositionsWithTicker(account.id);
    const priceResults: {
      position: PaperPositionWithTicker;
      bars: DailyBar[];
    }[] = [];
    // TossMarketDataClient의 공유 lastRequestAt 간격 가드는 동시 호출을 직렬화하지 못한다.
    // 1단계 보유 종목 평가는 rate limiter 경쟁과 HTTP 429를 피하려고 의도적으로 순차 조회한다.
    for (const position of positions) {
      let bars: DailyBar[] = [];
      try {
        bars = sortBars(
          await this.marketData.fetchDailyBars(position.ticker.tossSymbol, 2, {
            adjusted: false,
          }),
        );
      } catch {
        // 종목 하나의 조회 실패로 전체 실행을 예외 처리하면 어떤 종목이 빠졌는지 audit과
        // Slack에 남지 않는다. 빈 봉과 같은 unpriced 근거로 변환하고 아래에서 적재를 막는다.
        bars = [];
      }
      priceResults.push({ position, bars });
    }
    const unpricedPositions = priceResults.flatMap(
      ({ position, bars }): UnpricedPositionRow[] => {
        if (bars.length > 0) {
          return [];
        }
        return [
          {
            tickerId: position.tickerId,
            tickerCode: position.ticker.code,
            tickerName: position.ticker.name,
            quantity: position.quantity.toString(),
            avgPrice: position.avgPrice.toString(),
          },
        ];
      },
    );
    const pricedPositions: PositionPrice[] = priceResults.flatMap((result) => {
      const latest = result.bars.at(-1);
      return latest ? [{ ...result, latest }] : [];
    });
    const staleTickerCount = pricedPositions.filter(
      (result) => dateText(result.latest.tradeDate) !== tradeDateText,
    ).length;
    const cashBalance = account.cashBalance.toString();
    // 시세 자체가 없는 종목은 필수 가격 필드를 만들 수 없으므로 positions에는 가격 근거가
    // 있는 행만 싣는다. positionCount와의 차이 및 skipReason이 미확보 종목의 존재를 드러낸다.
    const evaluatedPositions = buildEvaluatedPositionRows(
      pricedPositions,
      tradeDate,
    );

    // 실행일을 봉들의 다수결로 바꾸면 휴장일에도 다수 그룹이 non-stale이 된다.
    // KST 실행일과 직접 비교하고 전 종목이 오래된 날은 어떤 후속 검증·쓰기보다 먼저 막는다.
    if (positions.length > 0 && staleTickerCount === positions.length) {
      return {
        skipped: true,
        skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
        tradeDate: tradeDateText,
        cashBalance,
        ...emptyCashSettlementSummary(cashBalance),
        positionValue: null,
        totalValue: null,
        returnRate: null,
        realizedPnl: null,
        unrealizedPnl: null,
        benchmarkClose: null,
        positions: evaluatedPositions,
        unpricedPositions,
        positionCount: positions.length,
        staleTickerCount,
        invariantViolations: [],
        suspiciousJumps: [],
      };
    }
    if (unpricedPositions.length > 0) {
      const missingCodes = unpricedPositions
        .map((position) => position.tickerCode)
        .join(', ');
      return {
        skipped: true,
        skipReason: `${unpricedPositions.length}개 보유 종목의 평가 시세를 찾을 수 없습니다: ${missingCodes}`,
        tradeDate: tradeDateText,
        cashBalance,
        ...emptyCashSettlementSummary(cashBalance),
        positionValue: null,
        totalValue: null,
        returnRate: null,
        realizedPnl: null,
        unrealizedPnl: null,
        benchmarkClose: null,
        positions: evaluatedPositions,
        unpricedPositions,
        positionCount: positions.length,
        staleTickerCount,
        invariantViolations: [],
        suspiciousJumps: [],
      };
    }

    const tickerLabelById = new Map(
      pricedPositions.map(({ position }) => [
        position.tickerId,
        `${position.ticker.name}(${position.ticker.code})`,
      ]),
    );
    const suspiciousJumps = detectSuspiciousPriceJump(
      pricedPositions.flatMap(({ position, bars }) => {
        if (bars.length < 2) {
          return [];
        }
        return [
          {
            tickerId: position.tickerId,
            previousClose: new Prisma.Decimal(bars.at(-2)!.close.toString()),
            currentClose: new Prisma.Decimal(bars.at(-1)!.close.toString()),
          },
        ];
      }),
    ).map((jump) =>
      describeSuspiciousPriceJump(
        jump,
        tickerLabelById.get(jump.tickerId) ?? `종목 ${jump.tickerId}`,
      ),
    );
    if (suspiciousJumps.length > 0) {
      return {
        skipped: true,
        skipReason:
          '분할·배당락 등 기업행동이 의심되는 가격 변동을 발견했습니다.',
        tradeDate: tradeDateText,
        cashBalance,
        ...emptyCashSettlementSummary(cashBalance),
        positionValue: null,
        totalValue: null,
        returnRate: null,
        realizedPnl: null,
        unrealizedPnl: null,
        benchmarkClose: null,
        positions: evaluatedPositions,
        unpricedPositions,
        positionCount: positions.length,
        staleTickerCount,
        invariantViolations: [],
        suspiciousJumps,
      };
    }

    const expectedTickerIds = positions.map((position) => position.tickerId);
    return await this.repository.saveEquitySnapshotWithRevalidatedState<EvaluateAccountResult>(
      account.id,
      (freshState) => {
        const freshTickerIds = freshState.positions.map(
          (position) => position.tickerId,
        );
        const accountStateChanged =
          freshState.account.cashBalance.comparedTo(account.cashBalance) !==
            0 ||
          freshTickerIds.length !== expectedTickerIds.length ||
          freshTickerIds.some(
            (tickerId, index) => tickerId !== expectedTickerIds[index],
          );
        if (accountStateChanged) {
          return {
            snapshot: null,
            result: {
              skipped: true,
              skipReason:
                '시세 조회 중 계좌 상태가 변경되어 스냅샷을 적재하지 않았습니다.',
              tradeDate: tradeDateText,
              cashBalance: freshState.account.cashBalance.toString(),
              ...emptyCashSettlementSummary(
                freshState.account.cashBalance.toString(),
              ),
              positionValue: null,
              totalValue: null,
              returnRate: null,
              realizedPnl: null,
              unrealizedPnl: null,
              benchmarkClose: null,
              positions: evaluatedPositions,
              unpricedPositions,
              positionCount: positions.length,
              staleTickerCount,
              invariantViolations: [],
              suspiciousJumps: [],
            },
          };
        }

        const invariantViolations = verifyPaperInvariants({
          seedAmount: freshState.account.seedAmount,
          cashBalance: freshState.account.cashBalance,
          trades: freshState.trades,
          positions: freshState.positions.map((position) => ({
            tickerId: position.tickerId,
            quantity: position.quantity,
          })),
          corporateActions: freshState.corporateActions,
        }).map((violation) => violation.detail);
        const cashSettlement = calculateCashSettlementSummary({
          cashBalance: freshState.account.cashBalance,
          tradeDate,
          trades: freshState.trades,
          corporateActions: freshState.corporateActions,
        });
        if (invariantViolations.length > 0) {
          return {
            snapshot: null,
            result: {
              skipped: true,
              skipReason: '거래 원장과 계좌 상태의 불변식이 일치하지 않습니다.',
              tradeDate: tradeDateText,
              cashBalance: freshState.account.cashBalance.toString(),
              ...cashSettlement,
              positionValue: null,
              totalValue: null,
              returnRate: null,
              realizedPnl: null,
              unrealizedPnl: null,
              benchmarkClose: null,
              positions: evaluatedPositions,
              unpricedPositions,
              positionCount: freshState.positions.length,
              staleTickerCount,
              invariantViolations,
              suspiciousJumps: [],
            },
          };
        }

        const latestByTickerId = new Map(
          pricedPositions.map(({ position, latest }) => [
            position.tickerId,
            latest,
          ]),
        );
        const valuation = calculateAccountValuation({
          seedAmount: freshState.account.seedAmount,
          cashBalance: freshState.account.cashBalance,
          tradeDate,
          positions: freshState.positions.map((position) => {
            const latest = latestByTickerId.get(position.tickerId)!;
            return {
              tickerId: position.tickerId,
              quantity: position.quantity,
              avgPrice: position.avgPrice,
              price: new Prisma.Decimal(latest.close.toString()),
              priceDate: latest.tradeDate,
            };
          }),
        });
        const snapshot = {
          accountId: account.id,
          tradeDate,
          cashBalance: freshState.account.cashBalance.toString(),
          positionValue: valuation.positionValue,
          totalValue: valuation.totalValue,
          returnRate: valuation.returnRate,
          realizedPnl: valuation.realizedPnl,
          unrealizedPnl: valuation.unrealizedPnl,
          staleTickerCount: valuation.staleTickerCount,
          positions: freshState.positions.map((position) => {
            const latest = latestByTickerId.get(position.tickerId)!;
            return {
              tickerId: position.tickerId,
              quantity: position.quantity.toString(),
              avgPrice: position.avgPrice.toString(),
              price: latest.close.toString(),
              priceDate: latest.tradeDate,
              isStale: dateText(latest.tradeDate) !== tradeDateText,
            };
          }),
        };
        return {
          snapshot,
          result: {
            skipped: false,
            tradeDate: tradeDateText,
            cashBalance: freshState.account.cashBalance.toString(),
            ...cashSettlement,
            positionValue: valuation.positionValue,
            totalValue: valuation.totalValue,
            returnRate: valuation.returnRate,
            realizedPnl: valuation.realizedPnl,
            tradingRealizedPnl: new Prisma.Decimal(valuation.realizedPnl)
              .minus(cashSettlement.dividendNetTotal)
              .toString(),
            unrealizedPnl: valuation.unrealizedPnl,
            previousReturnRate: previousSnapshot?.returnRate.toString() ?? null,
            previousTradeDate: previousSnapshot
              ? dateText(previousSnapshot.tradeDate)
              : null,
            benchmarkClose: null,
            positions: evaluatedPositions,
            unpricedPositions,
            positionCount: freshState.positions.length,
            staleTickerCount: valuation.staleTickerCount,
            invariantViolations: [],
            suspiciousJumps: [],
          },
        };
      },
    );
  }
}
