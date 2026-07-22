import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  detectAvgPriceBreach,
  detectDailyChange,
  isMarketClosed,
} from '../../../agent/stock/domain/stock-anomaly';
import {
  HoldingSnapshot,
  StockAnomaly,
  StoredStockAlert,
} from '../../../agent/stock/domain/stock-monitor.type';
import { formatStockMonitorSummary } from '../../../agent/stock/infrastructure/stock-monitor.formatter';
import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
import { DailyBar } from '../../../market-data/domain/market-data.type';
import {
  MARKET_DATA_PORT,
  MarketDataPort,
} from '../../../market-data/domain/port/market-data.port';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 판정에 필요한 최소 봉 수(당일 + 전일). 여유를 두고 5거래일을 받는다.
const REQUIRED_BARS = 5;

interface CollectedHolding {
  holding: HoldingSnapshot & { tickerId: number };
  today: DailyBar;
  yesterday: DailyBar | null;
  previousStoredDate: Date | null;
}

const restoreStockAnomaly = (
  holding: HoldingSnapshot,
  alert: StoredStockAlert,
): StockAnomaly | null => {
  if (alert.ruleId === 'daily-change') {
    const direction = alert.triggeredValue > 0 ? '급등' : '급락';
    return {
      tickerName: holding.tickerName,
      yahooSymbol: holding.yahooSymbol,
      kind: 'DAILY_CHANGE',
      ...alert,
      detail: `전일 대비 ${alert.triggeredValue.toFixed(1)}% ${direction}`,
    };
  }
  if (alert.ruleId === 'avg-price-breach') {
    const label = alert.triggeredValue < 0 ? '손실' : '수익';
    return {
      tickerName: holding.tickerName,
      yahooSymbol: holding.yahooSymbol,
      kind: 'AVG_PRICE_BREACH',
      ...alert,
      detail: `평단 대비 ${alert.triggeredValue.toFixed(1)}% ${label} 구간 진입`,
    };
  }
  return null;
};

@Injectable()
export class StockMonitorAutopilotTask implements AutopilotTask {
  readonly id = 'stock-monitor';
  private readonly logger = new Logger(StockMonitorAutopilotTask.name);

  constructor(
    @Inject(MARKET_DATA_PORT) private readonly marketData: MarketDataPort,
    private readonly repository: StockMonitorRepository,
    private readonly configService: ConfigService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('STOCK_MONITOR_ENABLED');
    if (enabled !== 'true') {
      return { skip: true };
    }

    const holdings = await this.repository.findCurrentHoldings();
    if (holdings.length === 0) {
      return { skip: true };
    }

    const anomalies: StockAnomaly[] = [];
    const failures: string[] = [];
    const collectedHoldings: CollectedHolding[] = [];
    let lastTradeDate = '';

    for (const holding of holdings) {
      let bars: DailyBar[] = [];
      try {
        bars = await this.marketData.fetchDailyBars(
          holding.yahooSymbol,
          REQUIRED_BARS,
        );
      } catch (error) {
        failures.push(`${holding.yahooSymbol}: ${(error as Error).message}`);
        continue;
      }

      const today = bars.at(-1);
      const yesterday = bars.at(-2) ?? null;
      if (!today) {
        failures.push(`${holding.yahooSymbol}: 봉 없음`);
        continue;
      }

      const tradeDate = today.tradeDate.toISOString().slice(0, 10);
      if (tradeDate > lastTradeDate) {
        lastTradeDate = tradeDate;
      }

      const previousStoredDate =
        await this.repository.findLatestStoredTradeDate(holding.tickerId);
      collectedHoldings.push({
        holding,
        today,
        yesterday,
        previousStoredDate,
      });
    }

    const hasCurrentDateCheckpoint = collectedHoldings.some(
      ({ today, previousStoredDate }) =>
        isMarketClosed(today.tradeDate, previousStoredDate) &&
        today.tradeDate.toISOString().slice(0, 10) === context.firedAtKst,
    );
    const marketClosed =
      collectedHoldings.length > 0 &&
      !hasCurrentDateCheckpoint &&
      collectedHoldings.every(({ today, previousStoredDate }) =>
        isMarketClosed(today.tradeDate, previousStoredDate),
      );
    if (marketClosed) {
      this.logger.log(
        `주식 모니터링 — 휴장(추정), 마지막 거래일 ${lastTradeDate}`,
      );
      return {
        skip: false,
        summaryText: formatStockMonitorSummary([], {
          checkedCount: collectedHoldings.length,
          lastTradeDate,
          failures,
          marketClosed: true,
        }),
      };
    }

    let checkedCount = 0;
    for (const {
      holding,
      today,
      yesterday,
      previousStoredDate,
    } of collectedHoldings) {
      if (isMarketClosed(today.tradeDate, previousStoredDate)) {
        const tradeDate = today.tradeDate.toISOString().slice(0, 10);
        if (tradeDate === context.firedAtKst) {
          try {
            const storedAlerts = await this.repository.findAlertsByTradeDate(
              holding.tickerId,
              today.tradeDate,
            );
            for (const storedAlert of storedAlerts) {
              const restored = restoreStockAnomaly(holding, storedAlert);
              if (restored) {
                anomalies.push(restored);
              }
            }
            checkedCount += 1;
          } catch (error) {
            failures.push(
              `${holding.yahooSymbol}: 알림 복구 실패 — ${(error as Error).message}`,
            );
          }
          continue;
        }
        failures.push(`${holding.yahooSymbol}: 신규 거래일 봉 없음`);
        continue;
      }

      const holdingAnomalies: StockAnomaly[] = [];
      try {
        for (const detect of [detectDailyChange, detectAvgPriceBreach]) {
          const anomaly = detect(holding, today, yesterday);
          if (!anomaly) {
            continue;
          }
          holdingAnomalies.push(anomaly);
          await this.repository.recordAlert({
            tickerId: holding.tickerId,
            tradeDate: today.tradeDate,
            ruleId: anomaly.ruleId,
            ruleVersion: anomaly.ruleVersion,
            triggeredValue: anomaly.triggeredValue.toFixed(4),
            threshold: anomaly.threshold.toFixed(4),
          });
        }

        // 가격 저장을 종목별 완료 checkpoint로 사용한다. 알림 기록보다 먼저 저장하면
        // 부분 실패 재시도에서 같은 날짜를 휴장으로 오판해 남은 알림을 복구하지 못한다.
        await this.repository.upsertDailyPrice({
          tickerId: holding.tickerId,
          tradeDate: today.tradeDate,
          close: today.close.toString(),
          adjClose: today.adjClose.toString(),
          volume: today.volume,
        });
      } catch (error) {
        failures.push(
          `${holding.yahooSymbol}: 저장 실패 — ${(error as Error).message}`,
        );
        continue;
      }

      anomalies.push(...holdingAnomalies);
      checkedCount += 1;
    }

    this.logger.log(
      `주식 모니터링 — ${holdings.length}종목, 발화 ${anomalies.length}건, 실패 ${failures.length}건`,
    );

    return {
      skip: false,
      summaryText: formatStockMonitorSummary(anomalies, {
        checkedCount,
        lastTradeDate: lastTradeDate || '알 수 없음',
        failures,
        marketClosed: false,
      }),
    };
  }
}
