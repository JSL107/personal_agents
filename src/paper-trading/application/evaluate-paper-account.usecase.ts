import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { DailyBar } from '../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../market-data/domain/port/market-data.port';
import { detectSuspiciousPriceJump } from '../domain/corporate-action-guard';
import { verifyPaperInvariants } from '../domain/paper-invariant';
import {
  calculateAccountValuation,
  calculatePositionValuation,
} from '../domain/paper-valuation';
import {
  PaperPositionWithTicker,
  PaperTradingRepository,
} from '../infrastructure/paper-trading.repository';

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
  positionValue: string | null;
  totalValue: string | null;
  returnRate: string | null;
  benchmarkClose: string | null;
  positions: EvaluatedPositionRow[];
  unpricedPositions: UnpricedPositionRow[];
  positionCount: number;
  staleTickerCount: number;
  invariantViolations: string[];
  suspiciousJumps: string[];
}

interface PositionPrice {
  position: PaperPositionWithTicker;
  bars: DailyBar[];
  latest: DailyBar;
}

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
    private readonly repository: PaperTradingRepository,
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
  ) {}

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
    const positions = await this.repository.findPositionsWithTicker(account.id);
    const priceResults = await Promise.all(
      positions.map(async (position) => {
        let bars: DailyBar[] = [];
        try {
          bars = sortBars(
            await this.marketData.fetchDailyBars(
              position.ticker.tossSymbol,
              2,
              { adjusted: false },
            ),
          );
        } catch {
          // 종목 하나의 조회 실패로 전체 실행을 예외 처리하면 어떤 종목이 빠졌는지 audit과
          // Slack에 남지 않는다. 빈 봉과 같은 unpriced 근거로 변환하고 아래에서 적재를 막는다.
          bars = [];
        }
        return { position, bars };
      }),
    );
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
        positionValue: null,
        totalValue: null,
        returnRate: null,
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
        positionValue: null,
        totalValue: null,
        returnRate: null,
        benchmarkClose: null,
        positions: evaluatedPositions,
        unpricedPositions,
        positionCount: positions.length,
        staleTickerCount,
        invariantViolations: [],
        suspiciousJumps: [],
      };
    }

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
    ).map(
      (jump) =>
        `종목 ${jump.tickerId} 가격 비정상 점프: 전일 대비 ${jump.ratio}배 (${jump.suspectedRatio}:1 분할 의심)`,
    );
    if (suspiciousJumps.length > 0) {
      return {
        skipped: true,
        skipReason: '분할 등 기업행동이 의심되는 가격 변동을 발견했습니다.',
        tradeDate: tradeDateText,
        cashBalance,
        positionValue: null,
        totalValue: null,
        returnRate: null,
        benchmarkClose: null,
        positions: evaluatedPositions,
        unpricedPositions,
        positionCount: positions.length,
        staleTickerCount,
        invariantViolations: [],
        suspiciousJumps,
      };
    }

    const trades = await this.repository.findTradesForInvariant(account.id);
    const invariantViolations = verifyPaperInvariants({
      seedAmount: account.seedAmount,
      cashBalance: account.cashBalance,
      trades,
      positions: positions.map((position) => ({
        tickerId: position.tickerId,
        quantity: position.quantity,
      })),
    }).map((violation) => violation.detail);
    if (invariantViolations.length > 0) {
      return {
        skipped: true,
        skipReason: '거래 원장과 계좌 상태의 불변식이 일치하지 않습니다.',
        tradeDate: tradeDateText,
        cashBalance,
        positionValue: null,
        totalValue: null,
        returnRate: null,
        benchmarkClose: null,
        positions: evaluatedPositions,
        unpricedPositions,
        positionCount: positions.length,
        staleTickerCount,
        invariantViolations,
        suspiciousJumps: [],
      };
    }

    const valuation = calculateAccountValuation({
      seedAmount: account.seedAmount,
      cashBalance: account.cashBalance,
      tradeDate,
      positions: pricedPositions.map(({ position, latest }) => ({
        tickerId: position.tickerId,
        quantity: position.quantity,
        avgPrice: position.avgPrice,
        price: new Prisma.Decimal(latest.close.toString()),
        priceDate: latest.tradeDate,
      })),
    });
    await this.repository.upsertEquitySnapshot({
      accountId: account.id,
      tradeDate,
      cashBalance: account.cashBalance.toString(),
      positionValue: valuation.positionValue,
      totalValue: valuation.totalValue,
      returnRate: valuation.returnRate,
      staleTickerCount: valuation.staleTickerCount,
      positions: pricedPositions.map(({ position, latest }) => ({
        tickerId: position.tickerId,
        quantity: position.quantity.toString(),
        avgPrice: position.avgPrice.toString(),
        price: latest.close.toString(),
        priceDate: latest.tradeDate,
        isStale: dateText(latest.tradeDate) !== tradeDateText,
      })),
    });

    return {
      skipped: false,
      tradeDate: tradeDateText,
      cashBalance,
      positionValue: valuation.positionValue,
      totalValue: valuation.totalValue,
      returnRate: valuation.returnRate,
      benchmarkClose: null,
      positions: evaluatedPositions,
      unpricedPositions,
      positionCount: positions.length,
      staleTickerCount: valuation.staleTickerCount,
      invariantViolations: [],
      suspiciousJumps: [],
    };
  }
}
