import { Injectable } from '@nestjs/common';

import {
  DEFAULT_HORIZON_DAYS,
  scoreAlert,
} from '../../../agent/stock/domain/alert-outcome';
import { StockMonitorRepository } from '../../../agent/stock/infrastructure/stock-monitor.repository';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class StockAlertScoringAutopilotTask implements AutopilotTask {
  readonly id = 'stock-alert-scoring';

  constructor(private readonly repository: StockMonitorRepository) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const alerts =
      await this.repository.findAlertsNeedingOutcome(DEFAULT_HORIZON_DAYS);
    let scoredCount = 0;

    for (const alert of alerts) {
      const prices = await this.repository.findDailyPricesSince(
        alert.tickerId,
        alert.tradeDate,
      );
      if (prices.length < DEFAULT_HORIZON_DAYS + 1) {
        continue;
      }
      if (prices[0].tradeDate.getTime() !== alert.tradeDate.getTime()) {
        continue;
      }

      const firedPrice = prices[0].adjClose;
      const horizonPrice = prices[DEFAULT_HORIZON_DAYS].adjClose;
      const outcome = scoreAlert(firedPrice, horizonPrice);
      if (!outcome) {
        continue;
      }

      await this.repository.upsertAlertOutcome({
        alertId: alert.alertId,
        horizonDays: DEFAULT_HORIZON_DAYS,
        firedPrice: firedPrice.toString(),
        horizonPrice: horizonPrice.toString(),
        returnPct: outcome.returnPct.toString(),
      });
      scoredCount += 1;
    }

    if (scoredCount === 0) {
      return { skip: true };
    }
    return {
      skip: false,
      summaryText: `주식 알림 사후 채점 — ${scoredCount}건 채점`,
    };
  }
}
