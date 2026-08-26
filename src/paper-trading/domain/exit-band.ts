// 보유 종목을 밴드 밖으로 나가면 정리하는 규칙. 판정은 그날 종가로 하고 체결은
// 다음 거래일 시가라, "밴드를 넘긴 그 가격에 팔린다"는 보장이 없다 — 갭에 그대로
// 노출된다. 장중 실시간 청산이 아니라 일봉 기반 시스템이라 생기는 구조적 지연이다.
//
// 값의 근거: docs/superpowers/specs/2026-08-21-exit-band-measurement.md.
// 표본 내(2026-01-02~05-29)에서 밴드 후보 6종 + 무밴드 대조군을 두 전략으로 돌려 고르고,
// 표본 밖(06-01~08-18)에서 그 선택이 요행이 아닌지 확인했다. 여덟 칸(2전략 x 2구간 x
// 최종·평균) 중 다섯 칸에서 +10 / -5 가 1위였고, 이전 값 +2 / -0.2 가 1위인 칸은 하나였다.
// 넓히는 방향은 두 전략·두 구간에서 일관됐지만 정확한 값이 좁혀진 것은 아니다 — 구간이
// 둘뿐이고 성격이 정반대(대세 상승 -> 급락)라 국면 차이가 밴드 차이보다 성적을 크게 흔든다.
// 다시 튜닝할 때는 구간을 새로 잘라야 한다(위 문서의 표를 보고 고르면 표본 밖이 아니게 된다).
export const DEFAULT_TAKE_PROFIT_PERCENT = 10;
export const DEFAULT_STOP_LOSS_PERCENT = -5;
export const INTRADAY_STOP_REASON_PREFIX = '장중 손절';

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

export interface IntradayStopCandidate {
  tickerId: number;
  tickerCode: string;
  quantity: string;
  returnRatePercent: number;
  price: string;
}

export interface IntradayStopDecision {
  tickerId: number;
  tickerCode: string;
  quantity: string;
  returnRatePercent: number;
  price: string;
}

export interface ExitBandSellOrderRecord {
  takeProfitPercent: string | null;
  stopLossPercent: string | null;
}

export interface ExitBandUsageSummary {
  // `+10/-5` 꼴 라벨. 이웃한 ruleVersions 가 Int[] 인 것과 같은 이유로 배열 하나에 담는다 —
  // 이 값으로 계산하는 코드는 없고(수치 원본은 paper_order 의 두 컬럼이다) 섞였는지만 읽는다.
  bands: string[];
  bandlessSellCount: number;
}

export const formatExitBandLabel = (band: ExitBandThreshold): string =>
  `+${band.takeProfitPercent}/${band.stopLossPercent}`;

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

// 종가 밴드는 하루 한 번 종가로 판정해 다음 거래일 시가에 체결하지만, 이 함수는 장중
// 관측 주기에 맞춰 손절만 판정한다. 판정가 즉시 체결은 급락장에서는 슬리피지로 성립하지
// 않을 수 있는 단순화이며, 실측 슬리피지를 반영하려면 별도 측정이 필요하다.
export const decideIntradayStopOrders = (
  candidates: IntradayStopCandidate[],
  stopLossPercent: number = DEFAULT_STOP_LOSS_PERCENT,
): IntradayStopDecision[] =>
  candidates.flatMap((candidate) => {
    const quantity = Number(candidate.quantity);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(candidate.returnRatePercent) ||
      candidate.returnRatePercent > stopLossPercent
    ) {
      return [];
    }
    return [
      {
        tickerId: candidate.tickerId,
        tickerCode: candidate.tickerCode,
        quantity: candidate.quantity,
        returnRatePercent: candidate.returnRatePercent,
        price: candidate.price,
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

export const describeIntradayStopReason = (
  decision: IntradayStopDecision,
  stopLossPercent: number = DEFAULT_STOP_LOSS_PERCENT,
): string =>
  `${INTRADAY_STOP_REASON_PREFIX} 밴드 이탈: 평가 손익률 ${decision.returnRatePercent.toFixed(2)}% (기준 ${stopLossPercent}% 이하, 판정가 ${decision.price}원)`;

// 이 구간의 매도 주문에 어떤 밴드 설정이 박혀 있었는지 모은다. 값이 둘 이상이면 밴드를 바꾼
// 구간을 걸친 표본이라는 뜻이고, 그 사실이 성적을 읽는 전제다 — 뭉뚱그리면 "밴드를 넓혀서
// 나아졌다" 를 옛 밴드의 성적으로 주장하게 된다(추천의 규칙 버전이 같은 이유로 집합이다).
//
// 사이클별 귀속이 아니다. "이 매수를 닫은 매도가 어느 밴드였나" 는 구간 집계가 생긴 뒤의
// 일이고, 그전까지 이 요약은 섞임을 드러내는 역할만 한다.
export const summarizeExitBandUsage = (
  sellOrders: ExitBandSellOrderRecord[],
): ExitBandUsageSummary => {
  const bands = new Map<string, ExitBandThreshold>();
  let bandlessSellCount = 0;
  for (const order of sellOrders) {
    // 밴드가 만들지 않은 매도(모델이 고른 매도)는 밴드 성적의 분모가 아니다. 건수로 남기지
    // 않으면 밴드 설정 하나로 닫힌 표본처럼 읽힌다.
    if (order.takeProfitPercent === null || order.stopLossPercent === null) {
      bandlessSellCount += 1;
      continue;
    }
    const band = {
      takeProfitPercent: Number(order.takeProfitPercent),
      stopLossPercent: Number(order.stopLossPercent),
    };
    bands.set(formatExitBandLabel(band), band);
  }
  return {
    bands: [...bands.values()]
      .sort((left, right) => {
        const takeProfitDifference =
          left.takeProfitPercent - right.takeProfitPercent;
        if (takeProfitDifference !== 0) {
          return takeProfitDifference;
        }
        // 익절이 같으면 손절이 0 에 가까운 쪽이 좁은 밴드다. 손절은 음수라 오름차순으로
        // 세우면 -5 가 -0.2 앞에 와 "좁은 것부터" 가 뒤집힌다.
        return right.stopLossPercent - left.stopLossPercent;
      })
      .map(formatExitBandLabel),
    bandlessSellCount,
  };
};
