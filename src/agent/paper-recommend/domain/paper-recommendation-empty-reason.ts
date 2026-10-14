export interface PaperRecommendationEmptyReason {
  code: 'NO_MARKET_DATA' | 'NO_CANDIDATES' | 'ALL_FILTERED' | 'MODEL_HELD';
  detail: string | null;
}

export interface DecidePaperRecommendationEmptyReasonInput {
  ordersCreated: number;
  dataAsOf: string | null;
  candidateCount: number;
  positionCount: number;
  proposedCount: number;
  holdReason?: string;
}

export const decidePaperRecommendationEmptyReason = ({
  ordersCreated,
  dataAsOf,
  candidateCount,
  positionCount,
  proposedCount,
  holdReason,
}: DecidePaperRecommendationEmptyReasonInput): PaperRecommendationEmptyReason | null => {
  if (ordersCreated > 0) {
    return null;
  }
  // 시세 부재, 전량 제외, 후보 부재, 모델의 보유 판단 순으로 판정한다.
  // 모델이 하나라도 제안했는데 주문이 0건이면 제약·수량 계산이 막은 것이다 — 제안 일부가
  // 제약을 통과했어도 수량이 0이면 주문이 안 생기므로, 건수 비교가 아니라 제안 유무로 가른다.
  // 후보가 없어도 보유 종목이 있으면 매도하지 않은 모델 판단을 남긴다.
  if (dataAsOf === null) {
    return { code: 'NO_MARKET_DATA', detail: null };
  }
  if (proposedCount > 0) {
    return { code: 'ALL_FILTERED', detail: null };
  }
  if (candidateCount === 0 && positionCount === 0) {
    return { code: 'NO_CANDIDATES', detail: null };
  }
  return {
    code: 'MODEL_HELD',
    detail: holdReason ?? null,
  };
};
