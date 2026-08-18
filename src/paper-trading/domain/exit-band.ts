// 보유 종목을 밴드 밖으로 나가면 정리하는 규칙. 판정은 그날 종가로 하고 체결은
// 다음 거래일 시가라, "밴드를 넘긴 그 가격에 팔린다"는 보장이 없다 — 갭에 그대로
// 노출된다. 장중 실시간 청산이 아니라 일봉 기반 시스템이라 생기는 구조적 지연이다.
export const DEFAULT_TAKE_PROFIT_PERCENT = 2;
export const DEFAULT_STOP_LOSS_PERCENT = -0.2;

export type ExitBandReason = 'TAKE_PROFIT' | 'STOP_LOSS';

export interface ExitBandThreshold {
  takeProfitPercent: number;
  stopLossPercent: number;
}

export interface ExitBandCandidate {
  tickerId: number;
  tickerCode: string;
  quantity: string;
  // paper-valuation 이 ×100 해서 내는 퍼센트 값이다. 0.02 가 아니라 2 가 2% 다.
  returnRate: string;
  isStale: boolean;
}

export interface ExitBandDecision {
  tickerId: number;
  tickerCode: string;
  quantity: string;
  reason: ExitBandReason;
  returnRatePercent: number;
}

export const DEFAULT_EXIT_BAND: ExitBandThreshold = {
  takeProfitPercent: DEFAULT_TAKE_PROFIT_PERCENT,
  stopLossPercent: DEFAULT_STOP_LOSS_PERCENT,
};

const reasonOf = (
  returnRatePercent: number,
  threshold: ExitBandThreshold,
): ExitBandReason | null => {
  if (returnRatePercent >= threshold.takeProfitPercent) {
    return 'TAKE_PROFIT';
  }
  if (returnRatePercent <= threshold.stopLossPercent) {
    return 'STOP_LOSS';
  }
  return null;
};

export const decideExitBandOrders = (
  candidates: ExitBandCandidate[],
  threshold: ExitBandThreshold = DEFAULT_EXIT_BAND,
): ExitBandDecision[] =>
  candidates.flatMap((candidate) => {
    // 실행일보다 오래된 시세로 손절하면 그 뒤의 반등을 못 본 채 판다. 값이 낡았다는
    // 사실 자체가 판정 불가 신호이므로 밴드에 태우지 않고 다음 회차로 넘긴다.
    if (candidate.isStale) {
      return [];
    }
    const returnRatePercent = Number(candidate.returnRate);
    const quantity = Number(candidate.quantity);
    if (!Number.isFinite(returnRatePercent) || !Number.isFinite(quantity)) {
      return [];
    }
    if (quantity <= 0) {
      return [];
    }
    const reason = reasonOf(returnRatePercent, threshold);
    if (reason === null) {
      return [];
    }
    return [
      {
        tickerId: candidate.tickerId,
        tickerCode: candidate.tickerCode,
        quantity: candidate.quantity,
        reason,
        returnRatePercent,
      },
    ];
  });

export const describeExitBandReason = (
  decision: ExitBandDecision,
  threshold: ExitBandThreshold = DEFAULT_EXIT_BAND,
): string => {
  const rate = decision.returnRatePercent.toFixed(2);
  if (decision.reason === 'TAKE_PROFIT') {
    return `익절 밴드 도달: 평가 손익률 ${rate}% (기준 +${threshold.takeProfitPercent}% 이상)`;
  }
  return `손절 밴드 이탈: 평가 손익률 ${rate}% (기준 ${threshold.stopLossPercent}% 이하)`;
};
