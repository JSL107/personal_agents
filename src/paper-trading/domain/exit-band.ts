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

// 밴드가 +10%/-5% 인데 평단 대비 ±50% 까지 벌어진 채 남아 있을 수는 없다. 하루 가격제한이
// ±30% 라 한 번에 갈 수 없고, 5분마다 도는 장중 손절과 하루 한 번 도는 종가 밴드가 그전에
// 정리했어야 한다. 그런데도 그 폭이라면 장부(수량·평단)와 시세가 서로 다른 기준으로 매겨진
// 것이다 — 기업행동 **다음** 거래일이 정확히 그 상태다.
//
// 그날은 전일 대비 변동이 이미 정상 범위로 돌아와 가격 점프 판정(`corporate-action-guard`)에
// 걸리지 않는다. 2026-08-28 배당락으로 종가가 10,930원에서 2,335원이 된 종목은, 다음 날
// 2,335원에서 정상 범위로 움직이는 순간 장부 평단 10,880원과 비교되어 다시 -78% 청산
// 대상이 된다. 위쪽도 같다 — 주식병합이면 주가가 뛴 채 장부 수량만 남아 익절이 나간다.
//
// 두 청산 경로(종가 밴드·장중 손절)가 모두 이 파일을 지나므로 여기서 한 번 막는다.
export const LEDGER_MISMATCH_RETURN_PERCENT = 50;

export const isLedgerMismatch = (returnRatePercent: number): boolean =>
  Math.abs(returnRatePercent) > LEDGER_MISMATCH_RETURN_PERCENT;

export const describeLedgerMismatch = (
  tickerLabel: string,
  returnRatePercent: number,
): string =>
  `${tickerLabel} 평가 손익률이 ${returnRatePercent.toFixed(2)}% 입니다 — ` +
  `밴드가 진작 정리했어야 할 폭이라 장부의 수량·평단이 기업행동 전 값으로 ` +
  `남아 있는 것으로 봅니다.`;

const reasonOf = (
  returnRatePercent: number,
  threshold: ExitBandThreshold,
): ExitBandReason | null => {
  if (isLedgerMismatch(returnRatePercent)) {
    return null;
  }
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
      candidate.returnRatePercent > stopLossPercent ||
      isLedgerMismatch(candidate.returnRatePercent)
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

// 재생(백테스트)이 장중 손절을 체결하는 가격. 운영은 손절선을 뚫는 그 순간의 현재가로
// 팔지만, 일봉만 있는 재생에는 그 순간이 없다. 남는 후보는 셋이고 실제 봉 22,107건으로
// 재서 골랐다.
//   - 그날 저가: 최저점에 팔았다고 가정한다. 손절선보다 평균 3.35%(중앙값 1.91%,
//     상위 10% 8.01%) 낮아 성적을 그만큼 비관적으로 만든다. 5분마다 재는 운영은 최저점을
//     겨냥하지 않으므로 이 값이 실제보다 나쁘다.
//   - 손절선 그대로: 시가부터 이미 손절선 아래인 갭하락이 발동일의 24.2% 인데, 그날은
//     그 가격에 팔 수가 없다. 그 구간이 통째로 낙관 편향이 된다.
//   - 둘 중 낮은 쪽(이 함수): 갭하락이면 장이 열리자마자 만나는 시가로, 아니면 손절선으로
//     체결한다. 실운영 장중 손절 2건(위더스제약 2026-08-27 · 씨젠 2026-08-31)의 판정가가
//     이 값과 원 단위로 일치했다.
// 남은 낙관은 손절선 그 가격에 체결된다는 가정이다 — 급락장 슬리피지는 별도 실측 대상이고,
// 자체 슬리피지를 모델링하지 않기로 한 결정이 여기에도 적용된다. 그 낙관이 얼마나 큰지는
// 모델링 대신 임계값으로 쟀다(docs/superpowers/specs/2026-09-02-slippage-breakeven-remeasurement.md):
// 체결가를 편도 0.2% 불리하게 잡으면 손절 -0.2% 밴드는 "사는 즉시 손절" 이 되어 무너지는데,
// 우리 유니버스의 1틱이 가격의 0.127%(중앙값)라 그 밴드는 애초에 1.58틱짜리다. 밴드를 이
// 폭까지 좁히는 변경은 그 마찰의 크기를 알기 전에는 근거가 서지 않는다.
export const resolveIntradayStopFillPrice = (input: {
  open: number;
  averagePrice: number;
  stopLossPercent: number;
}): number =>
  Math.min(input.open, input.averagePrice * (1 + input.stopLossPercent / 100));

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
