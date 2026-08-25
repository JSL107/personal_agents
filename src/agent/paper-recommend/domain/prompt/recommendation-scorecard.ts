import { RecommendationScoreSummary } from '../../../../paper-trading/domain/recommendation-score';
import { MAXIMUM_BUY_COUNT } from '../paper-recommendation.constraint';

// 지난 회차 추천이 어떤 성적을 냈는지 다음 추천 프롬프트에 되먹인다.
//
// 채점(`recommendation_score`)은 2026-08-19 부터 쌓였지만 읽는 코드가 없었다. 사람은 매주
// 금요일 카드로 성적을 보는데(`paper-score.formatter`) 정작 추천을 만드는 모델만 못 봤다.
//
// 싣는 지표는 **모델이 통제할 수 있는 것**으로 좁힌다. 회전율·MDD·누적비용·계좌수익률은
// 매도 밴드와 비중 배정이 정하는 값이라, 보여줘도 모델이 바꿀 수단이 없다. 반대로 무엇을
// 몇 종 사느냐는 모델의 판단이므로 적중률·평균수익·초과수익·최대손실을 싣는다.
//
// 🔴 **행을 합산하지 않는다.** 한 행이 계좌 개설 이후 누적이라(`schema.prisma` 의 `asOf`
// 주석) 여러 행을 더하면 같은 청산이 두 번 세어진다. 실제로 첫 판이 8/19(청산 3) + 8/21
// (청산 9) 을 12건으로 합산해 적중률을 25% 로 냈는데, 누적으로 읽으면 9건 중 2건 = 22% 다.
// 최신 행 하나가 곧 전체 성적이다.

/**
 * 합산 적중률을 낼 최소 청산 건수. 이보다 적으면 비율 대신 표본 수만 적는다 —
 * 몇 건짜리 비율이 판단 근거로 쓰이면 그건 추측이다.
 */
export const MINIMUM_CLOSED_SAMPLE = 5;

const formatRate = (rate: number | null): string => {
  if (rate === null) {
    return '-';
  }
  return `${(rate * 100).toFixed(1)}%`;
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

const hitLine = (latest: RecommendationScoreSummary): string => {
  if (latest.closedCount < MINIMUM_CLOSED_SAMPLE) {
    return `청산 ${latest.closedCount}건 — 표본 부족이라 적중률은 아직 판단 근거가 못 된다.`;
  }
  const rate = Math.round((latest.hitCount / latest.closedCount) * 100);
  return `청산 ${latest.closedCount}건 중 적중 ${latest.hitCount}건 (${rate}%).`;
};

// 초과수익은 지수 대비 성적이다. 마이너스면 "종목을 골라 산 것이 지수를 그냥 산 것보다
// 못했다" 는 뜻이라, 성적표에서 가장 먼저 읽어야 할 줄이다.
const excessNote = (latest: RecommendationScoreSummary): string => {
  if (latest.meanExcessReturnRate === null) {
    return '';
  }
  if (latest.meanExcessReturnRate >= 0) {
    return '';
  }
  return '\n초과수익이 마이너스다 — 이 전략의 추천이 지수를 따라가지 못했다.';
};

/**
 * 최신 채점 회차를 프롬프트 블록으로 만든다. 이력이 없으면 빈 문자열.
 *
 * 입력은 **한 행**이다. 누적 성적이라 여러 행을 넘겨 합산할 여지 자체를 두지 않는다.
 */
export const renderRecommendationScorecard = (
  latest: RecommendationScoreSummary | null,
): string => {
  if (latest === null) {
    return '';
  }

  return `

[이 전략의 추천 성적 — 계좌 개설 이후 ${formatDate(latest.asOf)}까지 누적]
${hitLine(latest)}
평균 ${formatRate(latest.meanReturnRate)} · 초과 ${formatRate(latest.meanExcessReturnRate)} · 최대손실 ${formatRate(latest.maximumLoss)}${excessNote(latest)}

이 성적을 보고 이번 회차의 판단을 조정하라. 매수는 최대 ${MAXIMUM_BUY_COUNT}종까지 허용될 뿐 채울 의무가 없다 — 확신이 낮은 후보는 빼는 편이 낫다.`;
};
