import { AgentRunStatRow } from '../../agent-run/domain/port/agent-run.repository.port';
import {
  RunAnomaly,
  RunAnomalyKind,
} from '../../autopilot/domain/run-retro.anomaly';

const ICON: Record<RunAnomalyKind, string> = {
  FAILURE_SPIKE: '🔴',
  LATENCY_CEILING: '⏱️',
  AGENT_DISAPPEARED: '💀',
  TOTAL_SILENCE: '🚨',
};

// kind 별 사후 해석 힌트(사실은 detail, 해석은 여기 — presentation 책임).
const HINT: Record<RunAnomalyKind, string> = {
  FAILURE_SPIKE: '',
  LATENCY_CEILING: ' — 인증/쿼터 소진 의심',
  AGENT_DISAPPEARED: ' — cron 사망 의심',
  TOTAL_SILENCE: ' — 시스템 전체 점검 필요',
};

// 조용한 계기판: 이상 0건이면 1줄 하트비트, 있으면 해당 항목만. LLM 없이 순수 포맷.
export const formatRunRetro = (
  current: AgentRunStatRow[],
  anomalies: RunAnomaly[],
  firedAtKst: string,
): string => {
  if (anomalies.length === 0) {
    const total = current.reduce((sum, row) => sum + row.total, 0);
    return `✅ *주간 회고* — ${firedAtKst} · 이상 없음 (${total}건 무장애, 최근 7일)`;
  }

  const isTotalSilence = anomalies.some(
    (item) => item.kind === 'TOTAL_SILENCE',
  );
  const header = isTotalSilence
    ? `🚨 *주간 회고* — ${firedAtKst} · 전체 침묵 (최근 7일)`
    : `🚨 *주간 회고* — ${firedAtKst} · 이상 ${anomalies.length}건 감지 (최근 7일)`;

  const lines = anomalies.map((item) => {
    const label = item.agentType ? `${item.agentType}: ` : '';
    return `• ${ICON[item.kind]} ${label}${item.detail}${HINT[item.kind]}`;
  });

  return [header, ...lines].join('\n');
};
