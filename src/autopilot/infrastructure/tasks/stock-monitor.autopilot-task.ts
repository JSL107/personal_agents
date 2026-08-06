import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { SyncHoldingsUsecase } from '../../../agent/stock/application/sync-holdings.usecase';
import { HoldingChange } from '../../../agent/stock/domain/holding-change';
import {
  detectAvgPriceBreach,
  detectDailyChange,
  isMarketClosed,
} from '../../../agent/stock/domain/stock-anomaly';
import {
  HoldingSnapshot,
  StockAnomaly,
  StockMarketCountry,
  StoredStockAlert,
} from '../../../agent/stock/domain/stock-monitor.type';
import {
  formatHoldingChanges,
  formatStockMonitorSummary,
  StockPriceDisplay,
} from '../../../agent/stock/infrastructure/stock-monitor.formatter';
import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DailyBar } from '../../../market-data/domain/market-data.type';
import { MarketDataPort } from '../../../market-data/domain/port/market-data.port';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 판정에 필요한 최소 봉 수(당일 + 전일). 여유를 두고 5거래일을 받는다.
const REQUIRED_BARS = 5;
const USD_KRW_PAIR = 'USDKRW';

// 원장(`agent_run.output`)에 남길 실행 요약. 화면에 보내는 summaryText 와 달리
// **일이 없었던 실행도** 남긴다 — holdingCount=0 이 기록되지 않으면 "감시는 켜져 있는데
// 대상이 한 종목도 없다"는 상태가 시스템 어디에도 나타나지 않는다. 실제로 그 상태로
// 방치되어 있었고, 그 사실이 관측되지 않은 것이 이 타입을 만든 이유다.
interface StockMonitorAudit {
  marketCountry: StockMarketCountry;
  holdingCount: number;
  checkedCount: number;
  anomalyCount: number;
  failureCount: number;
  lastTradeDate: string | null;
  marketClosed: boolean;
  syncedHoldings: number | null;
  zeroedHoldings: number | null;
  // 감지한 매매 건수. 0 은 "변화가 없었다", null 은 "동기화가 실패해 판정 자체를 못 했다" —
  // 둘 다 화면에는 아무 줄도 남기지 않으므로, 여기서 구분하지 않으면 감지가 죽어도 조용하다.
  // 사건의 상세는 holding_change 표에 있고 여기에는 건수만 둔다.
  holdingChangeCount: number | null;
  syncError: string | null;
}

interface StockMonitorRunResult {
  taskResult: AutopilotTaskResult;
  audit: StockMonitorAudit;
}

interface HoldingsSyncResult {
  synced: number | null;
  zeroed: number | null;
  changes: HoldingChange[];
  error: string | null;
}

export interface StockMonitorAutopilotTaskOptions {
  id: 'stock-monitor' | 'stock-monitor-us';
  targetMarketCountry: StockMarketCountry;
  now?: () => Date;
}

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
      symbol: holding.symbol,
      kind: 'DAILY_CHANGE',
      ...alert,
      detail: `전일 대비 ${alert.triggeredValue.toFixed(1)}% ${direction}`,
    };
  }
  if (alert.ruleId === 'avg-price-breach') {
    const label = alert.triggeredValue < 0 ? '손실' : '수익';
    return {
      tickerName: holding.tickerName,
      symbol: holding.symbol,
      kind: 'AVG_PRICE_BREACH',
      ...alert,
      detail: `평단 대비 ${alert.triggeredValue.toFixed(1)}% ${label} 구간 진입`,
    };
  }
  return null;
};

const resolveExpectedTradeDate = (
  firedAtKst: string,
  targetMarketCountry: StockMarketCountry,
  now: Date,
): string => {
  if (targetMarketCountry === 'KR') {
    return firedAtKst;
  }
  const dateParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = dateParts.find((part) => part.type === 'year')?.value;
  const month = dateParts.find((part) => part.type === 'month')?.value;
  const day = dateParts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const normalizePositiveDecimal = (value: string): string | null => {
  try {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite() || decimal.lte(0)) {
      return null;
    }
    return decimal.toString();
  } catch {
    return null;
  }
};

export class StockMonitorAutopilotTask implements AutopilotTask {
  readonly id: string;
  private readonly logger = new Logger(StockMonitorAutopilotTask.name);
  private readonly targetMarketCountry: StockMarketCountry;
  private readonly now: () => Date;

  constructor(
    options: StockMonitorAutopilotTaskOptions,
    private readonly marketData: MarketDataPort,
    private readonly repository: StockMonitorRepository,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
    private readonly syncHoldings: SyncHoldingsUsecase,
  ) {
    this.id = options.id;
    this.targetMarketCountry = options.targetMarketCountry;
    this.now = options.now ?? (() => new Date());
  }

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('STOCK_MONITOR_ENABLED');
    // 게이트는 원장 **밖**에 둔다. 꺼둔 것은 의도된 상태이므로 매일 "안 했다"를 남기면
    // 원장이 의미 없는 행으로 채워진다. 켠 뒤부터가 관측 대상이다.
    if (enabled !== 'true') {
      return { skip: true };
    }

    const outcome = await this.agentRunService.execute<StockMonitorRunResult>({
      agentType: AgentType.INVEST,
      triggerType: TriggerType.AUTOPILOT_INVEST_CRON,
      inputSnapshot: {
        taskId: this.id,
        marketCountry: this.targetMarketCountry,
        firedAtKst: context.firedAtKst,
      },
      run: async () => {
        const runResult = await this.monitor(context);
        // 판정은 순수 계산이라 LLM 을 거치지 않는다(VACATION 선례).
        return {
          result: runResult,
          modelUsed: 'deterministic',
          output: runResult.audit,
        };
      },
    });
    return outcome.result.taskResult;
  }

  private async monitor(
    context: AutopilotTaskContext,
  ): Promise<StockMonitorRunResult> {
    const sync = await this.syncCurrentHoldings();
    const holdings = await this.repository.findCurrentHoldings({
      marketCountry: this.targetMarketCountry,
    });
    if (holdings.length === 0) {
      // 화면에는 보내지 않되(빈 알림 방지) 원장에는 남긴다.
      return {
        taskResult: this.withSyncWarning(
          this.withHoldingChanges({ skip: true }, sync.changes),
          sync.error,
        ),
        audit: this.createAudit(sync, {
          holdingCount: 0,
          checkedCount: 0,
          anomalyCount: 0,
          failureCount: 0,
          lastTradeDate: null,
          marketClosed: false,
        }),
      };
    }

    const anomalies: StockAnomaly[] = [];
    const failures: string[] = [];
    const collectedHoldings: CollectedHolding[] = [];
    let lastTradeDate = '';

    for (const holding of holdings) {
      let bars: DailyBar[] = [];
      try {
        bars = await this.marketData.fetchDailyBars(
          holding.symbol,
          REQUIRED_BARS,
        );
      } catch (error) {
        failures.push(`${holding.symbol}: ${(error as Error).message}`);
        continue;
      }

      const today = bars.at(-1);
      const yesterday = bars.at(-2) ?? null;
      if (!today) {
        failures.push(`${holding.symbol}: 봉 없음`);
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

    const expectedTradeDate = resolveExpectedTradeDate(
      context.firedAtKst,
      this.targetMarketCountry,
      this.now(),
    );
    const hasCurrentDateCheckpoint = collectedHoldings.some(
      ({ today, previousStoredDate }) =>
        isMarketClosed(today.tradeDate, previousStoredDate) &&
        today.tradeDate.toISOString().slice(0, 10) === expectedTradeDate,
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
        taskResult: this.withSyncWarning(
          this.withHoldingChanges(
            {
              skip: false,
              summaryText: formatStockMonitorSummary([], {
                checkedCount: collectedHoldings.length,
                lastTradeDate,
                failures,
                marketClosed: true,
              }),
            },
            sync.changes,
          ),
          sync.error,
        ),
        audit: this.createAudit(sync, {
          holdingCount: holdings.length,
          checkedCount: collectedHoldings.length,
          anomalyCount: 0,
          failureCount: failures.length,
          lastTradeDate: lastTradeDate || null,
          marketClosed: true,
        }),
      };
    }

    const rateDate = lastTradeDate
      ? new Date(`${lastTradeDate}T00:00:00.000Z`)
      : null;
    const usdKrwRate = rateDate ? await this.resolveUsdKrwRate(rateDate) : null;
    const priceDisplays = this.createPriceDisplays(
      collectedHoldings,
      usdKrwRate,
    );

    let checkedCount = 0;
    for (const {
      holding,
      today,
      yesterday,
      previousStoredDate,
    } of collectedHoldings) {
      if (isMarketClosed(today.tradeDate, previousStoredDate)) {
        const tradeDate = today.tradeDate.toISOString().slice(0, 10);
        if (tradeDate === expectedTradeDate) {
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
              `${holding.symbol}: 알림 복구 실패 — ${(error as Error).message}`,
            );
          }
          continue;
        }
        failures.push(`${holding.symbol}: 신규 거래일 봉 없음`);
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
          `${holding.symbol}: 저장 실패 — ${(error as Error).message}`,
        );
        continue;
      }

      anomalies.push(...holdingAnomalies);
      checkedCount += 1;
    }

    this.logger.log(
      `주식 모니터링 — ${holdings.length}종목, 발화 ${anomalies.length}건, 실패 ${failures.length}건`,
    );

    // 한 종목도 점검하지 못했는데 실패만 쌓였다면 그 실행은 실패다. 여기서 정상 반환하면
    // 원장에 SUCCEEDED 로 남아 "감시가 돌았다"로 집계되고 /retry-run 대상에서도 빠진다
    // — 실패를 보이게 하려고 원장에 편입한 것이므로 그 자체가 자기모순이다.
    //
    // 부분 실패(checkedCount > 0)는 던지지 않는다. 한 종목이 막혀도 나머지를 처리하도록
    // 만든 설계를 유지해야 하고, 그 경우 실패 목록은 요약에 담겨 화면으로 나간다.
    //
    // 던진 예외는 AgentRunService 가 FAILED 로 기록하고 콘솔에 FAILED 상태를 발행한 뒤
    // 다시 던지며, orchestrator 가 그것을 잡아 그룹을 계속 돌리면서 owner 요약에
    // "⚠️ … 자동 생성 실패" 한 줄을 남긴다. 알림이 사라지지 않는다.
    if (checkedCount === 0 && failures.length > 0) {
      throw new Error(
        `보유 ${holdings.length}종목을 한 건도 점검하지 못했습니다 — ${failures.slice(0, 3).join(' / ')}`,
      );
    }

    return {
      taskResult: this.withSyncWarning(
        this.withHoldingChanges(
          {
            skip: false,
            summaryText: formatStockMonitorSummary(anomalies, {
              checkedCount,
              lastTradeDate: lastTradeDate || '알 수 없음',
              failures,
              marketClosed: false,
              priceDisplays,
            }),
          },
          sync.changes,
        ),
        sync.error,
      ),
      audit: this.createAudit(sync, {
        holdingCount: holdings.length,
        checkedCount,
        anomalyCount: anomalies.length,
        failureCount: failures.length,
        lastTradeDate: lastTradeDate || null,
        marketClosed: false,
      }),
    };
  }

  private createAudit(
    sync: HoldingsSyncResult,
    monitored: Omit<
      StockMonitorAudit,
      | 'marketCountry'
      | 'syncedHoldings'
      | 'zeroedHoldings'
      | 'holdingChangeCount'
      | 'syncError'
    >,
  ): StockMonitorAudit {
    return {
      marketCountry: this.targetMarketCountry,
      ...monitored,
      syncedHoldings: sync.synced,
      zeroedHoldings: sync.zeroed,
      holdingChangeCount: sync.error ? null : sync.changes.length,
      syncError: sync.error,
    };
  }

  private async syncCurrentHoldings(): Promise<HoldingsSyncResult> {
    try {
      const result = await this.syncHoldings.execute();
      return {
        synced: result.synced,
        zeroed: result.zeroed,
        changes: result.changes,
        error: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cappedMessage = message.slice(0, 200);
      this.logger.warn(`잔고 동기화 실패 — ${cappedMessage}`);
      return {
        synced: null,
        zeroed: null,
        changes: [],
        error: cappedMessage,
      };
    }
  }

  // 매매 사건은 감시 판정과 독립이다. 보유 종목이 없어 판정을 건너뛰는 실행에도(전량 매도 직후가
  // 그렇다) 사건은 알려야 하므로 skip 을 풀고 블록을 덧붙인다.
  private withHoldingChanges(
    result: AutopilotTaskResult,
    changes: HoldingChange[],
  ): AutopilotTaskResult {
    const changeText = formatHoldingChanges(changes);
    if (!changeText) {
      return result;
    }
    const summaryText = result.summaryText
      ? `${result.summaryText}\n\n${changeText}`
      : changeText;
    return { ...result, skip: false, summaryText };
  }

  private withSyncWarning(
    result: AutopilotTaskResult,
    syncError: string | null,
  ): AutopilotTaskResult {
    if (!syncError) {
      return result;
    }
    // 문구가 "이전 잔고 기준" 이면 사실과 다르다. SyncHoldingsUsecase 는 종목별로 개별
    // 커밋하므로(트랜잭션 없음), 중간 실패 시 앞 종목만 갱신된 혼합 상태가 된다.
    // 종목 간 참조 무결성이 없어 각 종목은 옛 값 아니면 새 값 — 어느 쪽도 유효했던 값이라
    // 데이터 문제는 아니지만, 무엇이 갱신됐는지 단정할 수 없다는 사실은 그대로 알려야 한다.
    const warning = `⚠️ 잔고 동기화 실패 — ${syncError}. 일부 종목의 평단·보유수량이 갱신되지 않았을 수 있습니다.`;
    const summaryText = result.summaryText
      ? `${warning}\n\n${result.summaryText}`
      : warning;
    return { ...result, skip: false, summaryText };
  }

  private async resolveUsdKrwRate(rateDate: Date): Promise<string | null> {
    if (this.targetMarketCountry !== 'US') {
      return null;
    }

    let fetchedRate: string | null = null;
    try {
      fetchedRate = await this.marketData.fetchUsdKrwRate();
    } catch (error) {
      this.logger.warn(`환율 조회 실패 — ${(error as Error).message}`);
    }

    const normalizedFetchedRate = fetchedRate
      ? normalizePositiveDecimal(fetchedRate)
      : null;
    if (normalizedFetchedRate) {
      try {
        await this.repository.upsertFxRate({
          pair: USD_KRW_PAIR,
          rateDate,
          rate: normalizedFetchedRate,
        });
      } catch (error) {
        this.logger.warn(`환율 저장 실패 — ${(error as Error).message}`);
      }
      return normalizedFetchedRate;
    }

    try {
      const storedRate = await this.repository.findFxRate({
        pair: USD_KRW_PAIR,
        rateDate,
      });
      return storedRate ? normalizePositiveDecimal(storedRate) : null;
    } catch (error) {
      this.logger.warn(`환율 재조회 실패 — ${(error as Error).message}`);
      return null;
    }
  }

  private createPriceDisplays(
    collectedHoldings: CollectedHolding[],
    usdKrwRate: string | null,
  ): StockPriceDisplay[] {
    if (this.targetMarketCountry !== 'US') {
      return [];
    }
    return collectedHoldings.map(({ holding, today }) => {
      const currentPrice = today.adjClose.toString();
      let convertedKrw: string | undefined;
      try {
        convertedKrw = usdKrwRate
          ? new Prisma.Decimal(currentPrice)
              .mul(usdKrwRate)
              .toDecimalPlaces(0)
              .toFixed(0)
          : undefined;
      } catch (error) {
        this.logger.warn(`환율 환산 실패 — ${(error as Error).message}`);
      }
      return {
        symbol: holding.symbol,
        currency: today.currency,
        currentPrice,
        convertedKrw,
      };
    });
  }
}
