import { QuotaStatsResult } from '../../agent-run/application/get-quota-stats.usecase';

// /quota 결과 — 사용자의 agent_run 사용량 통계 (provider 별 count + 평균/총 duration).
// 모델 호출 없는 DB 집계라 footer 미부착. since 시각은 ISO 그대로 노출 (사후 분석용).
export const formatQuotaStats = (stats: QuotaStatsResult): string => {
  const rangeLabel = stats.range === 'WEEK' ? '최근 7일' : '오늘 (24시간)';
  if (stats.totals.count === 0) {
    return [
      `*Quota 사용량 — ${rangeLabel}*`,
      '',
      `_${stats.sinceIso} 이후 본인 명의 agent_run 기록 없음._`,
    ].join('\n');
  }

  const lines: string[] = [
    `*Quota 사용량 — ${rangeLabel}*`,
    `_since ${stats.sinceIso}_`,
    '',
    '*Provider 별*',
  ];

  // count 내림차순 — 가장 많이 쓴 provider 가 위로.
  const sortedRows = [...stats.rows].sort((a, b) => b.count - a.count);
  for (const row of sortedRows) {
    const avgSec = (row.avgDurationMs / 1000).toFixed(1);
    const totalSec = (row.totalDurationMs / 1000).toFixed(1);
    lines.push(
      `• ${row.cliProvider} — ${row.count}회, 평균 ${avgSec}s · 총 ${totalSec}s`,
    );
  }

  const totalMin = (stats.totals.totalDurationMs / 60_000).toFixed(1);
  lines.push('', `*합계*: ${stats.totals.count}회 · 총 ${totalMin}분`);

  return lines.join('\n');
};
