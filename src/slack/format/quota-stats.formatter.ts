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

  // PM 컨텍스트 사용량 — OPS-3 (Slack Inbox) / PM-3' (FTS 유사 plan) 가
  // 실제로 plan 에 주입됐는지 가시화.
  const ctx = stats.pmContext;
  if (ctx.pmRunCount > 0) {
    lines.push('', '*PM 컨텍스트 주입*');
    const inboxAvg =
      ctx.pmRunCount > 0
        ? (ctx.totalInboxItems / ctx.pmRunCount).toFixed(1)
        : '0.0';
    const similarAvg =
      ctx.pmRunCount > 0
        ? (ctx.totalSimilarPlans / ctx.pmRunCount).toFixed(1)
        : '0.0';
    lines.push(
      `• PM 실행 ${ctx.pmRunCount}회 중 Slack Inbox 항목 누적 ${ctx.totalInboxItems}개 (실행당 평균 ${inboxAvg}개, ${ctx.pmRunsWithInbox}회 사용)`,
    );
    lines.push(
      `• 유사 plan(FTS) 누적 ${ctx.totalSimilarPlans}개 (실행당 평균 ${similarAvg}개, ${ctx.pmRunsWithSimilar}회 매칭)`,
    );
  }

  return lines.join('\n');
};
