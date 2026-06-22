import { AgentRunStatRow } from '../../agent-run/domain/port/agent-run.repository.port';

// Run Retro 통계 → Slack mrkdwn. 건수 내림차순. LLM 없이 순수 포맷.
export const formatRunRetro = (
  stats: AgentRunStatRow[],
  firedAtKst: string,
): string => {
  const sorted = [...stats].sort((first, second) => second.total - first.total);
  const lines = sorted.map((row) => {
    const failPct = Math.round(row.failRate * 100);
    const seconds = (row.avgDurationMs / 1000).toFixed(1);
    return `• ${row.agentType}: ${row.total}건 · 실패 ${row.failed} (${failPct}%) · 평균 ${seconds}s`;
  });
  const total = sorted.reduce((sum, row) => sum + row.total, 0);
  const totalFailed = sorted.reduce((sum, row) => sum + row.failed, 0);
  const totalPct = total > 0 ? Math.round((totalFailed / total) * 100) : 0;
  return [
    `📊 *주간 실행 회고* — ${firedAtKst} (최근 7일)`,
    ...lines,
    `총 ${total}건 · 전체 실패율 ${totalPct}%`,
  ].join('\n');
};
