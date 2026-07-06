import { AgentRunStatRow } from '../../agent-run/domain/port/agent-run.repository.port';

export type RunAnomalyKind =
  | 'FAILURE_SPIKE'
  | 'LATENCY_CEILING'
  | 'AGENT_DISAPPEARED'
  | 'TOTAL_SILENCE';

// TOTAL_SILENCE 는 시스템 전역 신호라 agentType 없음(null).
export interface RunAnomaly {
  agentType: string | null;
  kind: RunAnomalyKind;
  detail: string;
}

export const RUN_RETRO_THRESHOLDS = {
  failRate: 0.2,
  minFailed: 2,
  durationCeilingMs: 180_000,
  disappearMinPrev: 3,
} as const;

type Thresholds = typeof RUN_RETRO_THRESHOLDS;

// 두 윈도우(이번주 current, 지난주 previous)로 이상 신호를 판정하는 순수함수.
// 절대임계값(실패율·소요시간) + 사라짐(지난주 대비) + 전체침묵. 부작용 없음.
export const detectRunAnomalies = (
  current: AgentRunStatRow[],
  previous: AgentRunStatRow[],
  thresholds: Thresholds = RUN_RETRO_THRESHOLDS,
): RunAnomaly[] => {
  if (current.length === 0) {
    if (previous.length === 0) {
      return [];
    }
    const previousTotal = previous.reduce((sum, row) => sum + row.total, 0);
    return [
      {
        agentType: null,
        kind: 'TOTAL_SILENCE',
        detail: `이번주 실행 0건 (지난주 ${previousTotal}건)`,
      },
    ];
  }

  const anomalies: RunAnomaly[] = [];

  for (const row of current) {
    if (
      row.failed >= thresholds.minFailed &&
      row.failRate > thresholds.failRate
    ) {
      const percent = Math.round(row.failRate * 100);
      anomalies.push({
        agentType: row.agentType,
        kind: 'FAILURE_SPIKE',
        detail: `실패율 ${percent}% (${row.failed}/${row.total})`,
      });
    }
    if (row.avgDurationMs > thresholds.durationCeilingMs) {
      const seconds = (row.avgDurationMs / 1000).toFixed(1);
      anomalies.push({
        agentType: row.agentType,
        kind: 'LATENCY_CEILING',
        detail: `평균 ${seconds}s`,
      });
    }
  }

  const currentTypes = new Set(current.map((row) => row.agentType));
  for (const row of previous) {
    if (
      row.total >= thresholds.disappearMinPrev &&
      !currentTypes.has(row.agentType)
    ) {
      anomalies.push({
        agentType: row.agentType,
        kind: 'AGENT_DISAPPEARED',
        detail: `이번주 0건 (지난주 ${row.total}건)`,
      });
    }
  }

  return anomalies;
};
