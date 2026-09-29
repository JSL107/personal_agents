import { ApplicabilityStats } from '../../study-brief-cron/domain/port/study-brief.repository.port';

const REVIEW_CRITERIA =
  '_재검토 기준(배포 후 두 번째 요약부터): 채택+거절 5건 미만 · 적용 0건 또는 80% 이상 · 강등이 원 적용의 절반 이상 — 하나라도 해당하면 루프를 다시 설계하거나 접는다._';

export const formatStudyApplicabilityStats = (
  stats: ApplicabilityStats,
  decisions: { adopted: number; rejected: number },
): string => {
  const total = stats.apply + stats.reference + stats.notApplicable;
  if (total === 0 && stats.unjudgedExpired === 0) {
    return '';
  }
  const downgraded = stats.downgradeNoValidCitation + stats.downgradeNoProposal;
  return [
    '*🧭 오늘의 공부 적용 판정 (30일)*',
    `• 판정: 적용 ${stats.apply} · 참고 ${stats.reference} · 해당 없음 ${stats.notApplicable} · 미판정 ${stats.unjudgedExpired}`,
    `• 강등 ${downgraded}/${stats.rawApply} (근거 없음 ${stats.downgradeNoValidCitation} · 제안 없음 ${stats.downgradeNoProposal})`,
    `• 카드 결정: 채택 ${decisions.adopted} · 거절 ${decisions.rejected}`,
    REVIEW_CRITERIA,
  ].join('\n');
};
