import { RecommendationScoreSummary } from '../../../../paper-trading/domain/recommendation-score';
import { SelectionGapSummary } from '../../../../screener/domain/screening-scorecard';
import { MAXIMUM_BUY_COUNT } from '../paper-recommendation.constraint';

// 지난 회차 추천이 어떤 성적을 냈는지 다음 추천 프롬프트에 되먹인다.
//
// 채점(`recommendation_score`)은 2026-08-19 부터 쌓였지만 읽는 코드가 없었다. 사람은 매주
// 금요일 카드로 성적을 보는데(`paper-score.formatter`) 정작 추천을 만드는 모델만 못 봤다.
//
// 싣는 지표는 **모델이 통제할 수 있는 것**으로 좁힌다. 회전율·MDD·누적비용·계좌수익률은
// 매도 밴드와 비중 배정이 정하는 값이라, 보여줘도 모델이 바꿀 수단이 없다.
//
// 🔴 **절대 적중률을 싣지 않는다 (2026-10-21).** 적중은 "비용 뒤 손익 > 0" 이라 시장 전체가
// 빠지면 누가 골라도 낮다. 8/20~10/20 코스피 −19% 구간에 LONG_TERM 적중률은 32% 였고,
// 모델은 최근 9회차 중 4회를 "낮은 적중률" 을 이유로 관망했다. 같은 기간 이 전략은 코스피
// 대비 +3.2% 였고, 보고도 안 산 후보보다도 5거래일 기준 회차별 평균 +0.3%p(14회차) 앞섰다
// — 선택이 지수보다 나았는데 시장 몫이 섞인 숫자를 보고 멈춘 것이다. 그래서 종목 선택을 재는 두 줄(코스피 대비 · 안 산 후보 대비)을
// 앞세우고, 절대 성적은 참고로만 남긴다.
//
// 🔴 **행을 합산하지 않는다.** 한 행이 계좌 개설 이후 누적이라(`schema.prisma` 의 `asOf`
// 주석) 여러 행을 더하면 같은 청산이 두 번 세어진다. 실제로 첫 판이 8/19(청산 3) + 8/21
// (청산 9) 을 12건으로 합산해 적중률을 25% 로 냈는데, 누적으로 읽으면 9건 중 2건 = 22% 다.
// 최신 행 하나가 곧 전체 성적이다.

/**
 * 코스피 대비 초과를 숫자로 낼 최소 표본(초과수익에 실제로 들어간 추천 수). 이보다 적으면
 * 표본 수만 적는다 — 몇 건짜리 평균이 판단 근거로 쓰이면 그건 추측이다.
 */
export const MINIMUM_EXCESS_SAMPLE = 5;

/**
 * 비교 회차가 이보다 적으면 선택 격차를 숫자로 싣지 않는다. 회차 하나가 격차 하나라
 * 몇 개짜리 평균은 그 주 장세 몇 번의 우연이다.
 */
export const MINIMUM_GAP_RUN_COUNT = 5;

const formatRate = (rate: number | null): string => {
  if (rate === null) {
    return '-';
  }
  return `${(rate * 100).toFixed(1)}%`;
};

// 표시 자릿수(소수 한 자리)로 반올림한 뒤 부호를 가린다. 반올림 전 값으로 판정하면
// `+0.0%` 를 찍어 놓고 "나았다" 고 읽는 어긋남이 생긴다.
const roundForDisplay = (value: number): number => {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
};

const formatSigned = (rounded: number, unit: string): string =>
  `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}${unit}`;

const verdictOf = (
  rounded: number,
  words: { better: string; worse: string; tie: string },
): string => {
  if (rounded > 0) {
    return words.better;
  }
  if (rounded < 0) {
    return words.worse;
  }
  return words.tie;
};

const formatDate = (date: Date): string => date.toISOString().slice(0, 10);

// 추천마다 자기 보유 구간의 코스피 등락을 뺀 값의 평균이다(`recommendation-score.ts`).
const excessLine = (latest: RecommendationScoreSummary): string => {
  if (latest.meanExcessReturnRate === null) {
    return '코스피 대비: 지수 기록이 비어 산출하지 못했다.';
  }
  if (latest.excessSampleCount < MINIMUM_EXCESS_SAMPLE) {
    return `코스피 대비: 추천 ${latest.excessSampleCount}건 — 표본 부족이라 아직 판단 근거가 못 된다.`;
  }
  const rounded = roundForDisplay(latest.meanExcessReturnRate * 100);
  const verdict = verdictOf(rounded, {
    better: '지수를 그냥 산 것보다 나았다',
    worse: '지수를 따라가지 못했다',
    tie: '지수와 차이가 없었다',
  });
  return `코스피 대비: 보유 구간 코스피보다 평균 ${formatSigned(rounded, '%')} (추천 ${latest.excessSampleCount}건, 보유 중 포함) — ${verdict}.`;
};

// 같은 날 같은 출발가(다음 거래일 시가)에서 갈라 재므로 그 주의 장세가 양쪽에 똑같이
// 걸려 상쇄되고, 남는 차이가 종목 선택의 몫이다(`screening-scorecard.ts`).
const selectionLine = (gap: SelectionGapSummary | null): string => {
  const label = '보고도 안 고른 후보 대비';
  if (gap === null) {
    return `${label}: 조회하지 못했다.`;
  }
  if (gap.gapPct === null || gap.gapRunCount < MINIMUM_GAP_RUN_COUNT) {
    return `${label}: 비교 회차 ${gap.gapRunCount}개 — 표본 부족이라 아직 판단 근거가 못 된다.`;
  }
  const rounded = roundForDisplay(gap.gapPct);
  const verdict = verdictOf(rounded, {
    better: '고른 종목이 더 나았다',
    worse: '고른 종목이 더 못했다',
    tie: '차이가 없었다',
  });
  return `${label}: ${gap.horizonDays}거래일 뒤 평균 ${formatSigned(rounded, '%p')} (비교 회차 ${gap.gapRunCount}개) — ${verdict}.`;
};

/**
 * 최신 채점 회차와 선택 격차를 프롬프트 블록으로 만든다. 채점 이력이 없으면 빈 문자열.
 *
 * `latest` 는 **한 행**이다. 누적 성적이라 여러 행을 넘겨 합산할 여지 자체를 두지 않는다.
 * `selectionGap` 이 null 이면(조회 실패) 그 줄만 비우고 나머지를 싣는다.
 */
export const renderRecommendationScorecard = (
  latest: RecommendationScoreSummary | null,
  selectionGap: SelectionGapSummary | null,
): string => {
  if (latest === null) {
    return '';
  }

  return `

[이 전략의 추천 성적 — 계좌 개설 이후 ${formatDate(latest.asOf)}까지 누적]
${excessLine(latest)}
${selectionLine(selectionGap)}
참고 — 시장 전체 흐름이 섞인 절대 성적: 청산 ${latest.closedCount}건 · 평균 ${formatRate(latest.meanReturnRate)} · 최대손실 ${formatRate(latest.maximumLoss)}

종목을 잘 골랐는지는 앞의 두 줄로 판단하라. 절대 성적은 시장이 함께 오르내린 몫이 섞여 있어, 그것만으로는 관망할 근거가 되지 않는다. 매수는 최대 ${MAXIMUM_BUY_COUNT}종까지 허용될 뿐 채울 의무가 없다 — 확신이 낮은 후보는 빼는 편이 낫다.`;
};
