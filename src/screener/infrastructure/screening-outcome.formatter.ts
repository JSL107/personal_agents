import { ScoreScreeningOutcomesResult } from '../application/score-screening-outcomes.usecase';

// 건너뛴 이유를 사람 말로 옮긴다. 특히 "아직 안 옴" 은 고장이 아니므로 그렇게 읽혀야 한다.
const SKIP_LABELS = {
  NOT_DUE: '아직 지평 미도래',
  ENTRY_OPEN_MISSING: '진입일 시가 없음',
  ENTRY_PRICE_NOT_POSITIVE: '진입가 이상',
} as const;

export const formatScreeningOutcomeResult = (
  result: ScoreScreeningOutcomesResult,
): string => {
  const lines = ['*스크리닝 사후 채점*'];

  for (const horizon of result.horizons) {
    const skips = Object.entries(horizon.skipped)
      .filter(([, count]) => count > 0)
      .map(
        ([reason, count]) =>
          `${SKIP_LABELS[reason as keyof typeof SKIP_LABELS]} ${count}`,
      );
    const skipDetail = skips.length === 0 ? '' : ` · ${skips.join(' · ')}`;
    lines.push(
      `${horizon.horizonDays}거래일 — 대상 ${horizon.attemptedCount} · 채점 ${horizon.scoredCount}${skipDetail}`,
    );
  }

  if (result.totalScoredCount === 0) {
    lines.push(
      '새로 채점한 항목이 없습니다. 대상이 0이면 남은 회차가 없는 것이고, 대상은 있는데 채점이 0이면 위 사유를 보세요.',
    );
  }
  return lines.join('\n');
};
