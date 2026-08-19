import { Prisma } from '@prisma/client';

import { ScoreRecommendationsResult } from '../application/score-recommendations.usecase';

const formatDecimal = (value: string): string => {
  const decimal = new Prisma.Decimal(value).toString();
  const [integer, fraction] = decimal.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
};

const formatRate = (value: string | null): string => {
  if (value === null) {
    return '-';
  }
  const percent = new Prisma.Decimal(value).times(100).toDecimalPlaces(2);
  const sign = percent.comparedTo(0) > 0 ? '+' : '';
  return `${sign}${percent.toString()}%`;
};

const formatUnsignedRate = (value: string | null): string =>
  value === null
    ? '-'
    : `${new Prisma.Decimal(value).times(100).toDecimalPlaces(2).toString()}%`;

const formatDays = (value: string | null): string =>
  value === null ? '-' : `${new Prisma.Decimal(value).toDecimalPlaces(2)}일`;

// 규칙이 바뀐 구간을 걸친 집계는 그 사실을 읽는 사람이 알아야 한다. 버전 하나로 뭉뚱그리면
// "규칙을 바꿔서 나아졌다" 를 옛 규칙의 성적으로 주장하게 된다.
const formatRuleVersions = (ruleVersions: number[]): string => {
  if (ruleVersions.length === 0) {
    return '규칙 미기록';
  }
  if (ruleVersions.length === 1) {
    return `규칙 v${ruleVersions[0]}`;
  }
  return `규칙 v${ruleVersions.join('·v')} 혼합`;
};

export const formatPaperScoreReport = (
  result: ScoreRecommendationsResult,
): string => {
  const lines = [
    `*모의투자 추천 성적 — ${result.asOf.toISOString().slice(0, 10)}*`,
  ];

  for (const account of result.accounts) {
    const score = account.score;
    lines.push(
      '',
      `*${account.strategy}* · ${formatRuleVersions(account.ruleVersions)}`,
      `추천 ${score.recommendationCount}건 · 체결 ${score.closedCount + score.openCount}건(청산 ${score.closedCount}·보유 ${score.openCount}) · 미체결 ${score.expiredCount}건`,
      `적중 ${score.hitCount}/${score.closedCount} (${formatUnsignedRate(score.hitRate)})`,
      `평균 ${formatRate(score.meanReturnRate)} · 중앙값 ${formatRate(score.medianReturnRate)} · 최대 손실 ${formatRate(score.maximumLoss)}`,
      `평균 보유 ${formatDays(score.averageHoldingDays)} · 평균 초과 ${formatRate(account.meanExcessReturnRate)} · 그림자 평균 ${formatRate(account.meanShadowReturnRate)}`,
      `계좌 수익률 ${formatRate(account.portfolio.accountReturnRate)} · MDD ${formatRate(account.portfolio.maximumDrawdown)} · 회전율 ${account.portfolio.turnoverRate === null ? '-' : `${formatDecimal(account.portfolio.turnoverRate)}배`}`,
      `누적 비용 ${formatDecimal(account.portfolio.cumulativeCost)}원 · 실제 스냅샷 ${account.portfolio.snapshotCount}건`,
    );
    if (score.closedCount < 5) {
      lines.push(
        `⚠️ 청산 표본 5건 미만(${score.closedCount}건) — 수치를 단정적으로 해석하지 마세요.`,
      );
    }
  }

  lines.push(
    '',
    '*분류*',
    `청산 ${result.classifications.closed} · 보유 ${result.classifications.open} · 미체결 ${result.classifications.expired} · 이상치 ${result.classifications.anomaly}`,
    '*집계 제외·결손*',
    `미체결 ${result.exclusions.expired} · 벤치마크 결손 ${result.exclusions.benchmarkUnavailable} · 그림자 미산출 ${result.exclusions.shadowUnavailable} · 이상치 ${result.exclusions.anomaly} · realizedPnl 불일치 ${result.exclusions.realizedPnlMismatch}`,
    '',
    '_해석 한계: 실제는 다음 거래일 시가, 그림자는 같은 날 종가로 진입하므로 실제-그림자 차이에는 매도 판단뿐 아니라 진입 기준 차이도 포함됩니다._',
    '_현재 저장 close는 조정 계열입니다. 수집 방식 변경 시 그림자 계산을 재검토해야 합니다._',
  );
  return lines.join('\n');
};
