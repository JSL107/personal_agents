export interface BacktestFillRecord {
  tradeDate: string;
  filledAmount: number;
  accountValuation: number;
}

export interface BacktestExpirationRecord {
  tradeDate: string;
  statusReason: string;
}

export interface SummarizeBacktestMetricsInput {
  fills: BacktestFillRecord[];
  expirations: BacktestExpirationRecord[];
  targetWeightPercent: number;
  maximumPositions: number;
}

export interface BacktestMetricSummary {
  // 주문 수량은 전일 종가로 확정되고 체결은 다음날 시가라, 갭 상승분이 비중 상한을 넘긴다.
  // 2026-08-16 검증에서 실측한 결함이며 이 지표가 상시 감시한다.
  weightExceededCount: number;
  maximumWeightPercent: number;
  expirationsByReason: Record<string, number>;
  // 연휴 동안 추천이 쌓였다가 개장일에 한꺼번에 체결되는 현상의 관측치다.
  burstFillDayCount: number;
  maximumFillsInOneDay: number;
}

export const summarizeBacktestMetrics = (
  input: SummarizeBacktestMetricsInput,
): BacktestMetricSummary => {
  let weightExceededCount = 0;
  let maximumWeightPercent = 0;
  for (const fill of input.fills) {
    // 평가액이 0 이하면 비중이 무한대가 되어 지표 전체가 망가진다. 계좌가 빈 시점에
    // 실제로 나올 수 있는 값이라 여기서 걸러낸다.
    if (fill.accountValuation <= 0) {
      continue;
    }
    const weightPercent = (fill.filledAmount / fill.accountValuation) * 100;
    if (weightPercent > input.targetWeightPercent) {
      weightExceededCount += 1;
    }
    if (weightPercent > maximumWeightPercent) {
      maximumWeightPercent = weightPercent;
    }
  }

  const expirationsByReason: Record<string, number> = {};
  for (const expiration of input.expirations) {
    expirationsByReason[expiration.statusReason] =
      (expirationsByReason[expiration.statusReason] ?? 0) + 1;
  }

  const fillCountByDate = new Map<string, number>();
  for (const fill of input.fills) {
    fillCountByDate.set(
      fill.tradeDate,
      (fillCountByDate.get(fill.tradeDate) ?? 0) + 1,
    );
  }
  let burstFillDayCount = 0;
  let maximumFillsInOneDay = 0;
  for (const count of fillCountByDate.values()) {
    if (count > input.maximumPositions) {
      burstFillDayCount += 1;
    }
    if (count > maximumFillsInOneDay) {
      maximumFillsInOneDay = count;
    }
  }

  return {
    weightExceededCount,
    maximumWeightPercent,
    expirationsByReason,
    burstFillDayCount,
    maximumFillsInOneDay,
  };
};
