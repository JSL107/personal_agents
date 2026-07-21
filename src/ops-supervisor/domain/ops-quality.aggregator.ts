import {
  AgentRetryCountRow,
  AgentRunStatRow,
  AgentSweptCountRow,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { PreviewOutcomeRow } from '../../preview-gate/domain/port/preview-action.repository.port';
import {
  AgentQualityProfile,
  PreviewQualityProfile,
  QualityProfiles,
} from './ops-quality.type';

interface BuildInput {
  base: AgentRunStatRow[];
  retries: AgentRetryCountRow[];
  swept: AgentSweptCountRow[];
  previews: PreviewOutcomeRow[];
}

// 결정론 집계 — raw 통계 4종을 agentType/kind 프로필로 병합. 부작용 없음.
export const buildQualityProfiles = ({
  base,
  retries,
  swept,
  previews,
}: BuildInput): QualityProfiles => {
  const retryByType = new Map(
    retries.map((row) => [row.agentType, row.retries]),
  );
  const sweptByType = new Map(swept.map((row) => [row.agentType, row.swept]));

  const agents: AgentQualityProfile[] = base.map((row) => {
    const sweptCount = sweptByType.get(row.agentType) ?? 0;
    const retriesCount = retryByType.get(row.agentType) ?? 0;
    const failed = Math.max(0, row.failed - sweptCount);
    return {
      agentType: row.agentType,
      total: row.total,
      failed,
      failRate: row.total > 0 ? failed / row.total : 0,
      retries: retriesCount,
      retryRate: row.total > 0 ? retriesCount / row.total : 0,
      sweptCount,
    };
  });

  const previewProfiles: PreviewQualityProfile[] = previews.map((row) => {
    const total = row.applied + row.cancelled + row.expired;
    const rejected = row.cancelled + row.expired;
    return {
      kind: row.kind,
      applied: row.applied,
      cancelled: row.cancelled,
      expired: row.expired,
      total,
      rejectRate: total > 0 ? rejected / total : 0,
    };
  });

  return { agents, previews: previewProfiles };
};
