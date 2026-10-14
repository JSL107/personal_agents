import { decidePaperRecommendationEmptyReason } from './paper-recommendation-empty-reason';

const base = {
  ordersCreated: 0,
  dataAsOf: '2026-08-13',
  candidateCount: 1,
  positionCount: 0,
  proposedCount: 0,
  holdReason: '관망',
};

describe('decidePaperRecommendationEmptyReason', () => {
  it('주문이 있으면 이유가 없다', () => {
    expect(
      decidePaperRecommendationEmptyReason({ ...base, ordersCreated: 1 }),
    ).toBeNull();
  });
  it('시세 부재를 최우선으로 판정한다', () => {
    expect(
      decidePaperRecommendationEmptyReason({
        ...base,
        dataAsOf: null,
        proposedCount: 1,
      }),
    ).toEqual({ code: 'NO_MARKET_DATA', detail: null });
  });
  it('모든 제안이 제외되면 ALL_FILTERED다', () => {
    expect(
      decidePaperRecommendationEmptyReason({
        ...base,
        proposedCount: 1,
      }),
    ).toEqual({ code: 'ALL_FILTERED', detail: null });
  });
  // 제약을 통과한 제안이 있어도 수량이 0이면 주문이 안 생긴다 — 이걸 「보유 유지」로 적으면
  // 모델이 사려던 날을 관망한 날로 잘못 센다.
  it('제안이 있었는데 주문이 0건이면 일부만 제외됐어도 ALL_FILTERED다', () => {
    expect(
      decidePaperRecommendationEmptyReason({ ...base, proposedCount: 2 }),
    ).toEqual({ code: 'ALL_FILTERED', detail: null });
  });
  it('후보도 보유 종목도 없으면 NO_CANDIDATES다', () => {
    expect(
      decidePaperRecommendationEmptyReason({ ...base, candidateCount: 0 }),
    ).toEqual({ code: 'NO_CANDIDATES', detail: null });
  });
  it('모델이 보유를 판단한 이유를 남긴다', () => {
    expect(decidePaperRecommendationEmptyReason(base)).toEqual({
      code: 'MODEL_HELD',
      detail: '관망',
    });
    expect(
      decidePaperRecommendationEmptyReason({
        ...base,
        candidateCount: 0,
        positionCount: 1,
      }),
    ).toEqual({ code: 'MODEL_HELD', detail: '관망' });
  });
});
