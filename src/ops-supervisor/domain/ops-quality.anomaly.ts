import { QualityProfiles } from './ops-quality.type';

export type QualityAnomalyKind =
  | 'FAIL_RATE'
  | 'RETRY_RATE'
  | 'ZOMBIE'
  | 'PREVIEW_REJECT';

export interface QualityAnomaly {
  scope: 'agent' | 'preview';
  key: string;
  kind: QualityAnomalyKind;
  detail: string;
}

export const OPS_SUPERVISOR_THRESHOLDS = {
  failRate: 0.2,
  minTotal: 5,
  retryRate: 0.15,
  previewRejectRate: 0.3,
  minPreviewTotal: 3,
} as const;

type Thresholds = typeof OPS_SUPERVISOR_THRESHOLDS;

// 품질 프로필의 절대 임계와 최소 표본으로 이상 신호를 판정한다.
export const detectQualityAnomalies = (
  profiles: QualityProfiles,
  thresholds: Thresholds = OPS_SUPERVISOR_THRESHOLDS,
): QualityAnomaly[] => {
  const anomalies: QualityAnomaly[] = [];

  for (const agent of profiles.agents) {
    if (
      agent.total >= thresholds.minTotal &&
      agent.failRate > thresholds.failRate
    ) {
      const percent = Math.round(agent.failRate * 100);
      anomalies.push({
        scope: 'agent',
        key: agent.agentType,
        kind: 'FAIL_RATE',
        detail: `실패율 ${percent}% (${agent.failed}/${agent.total}, 좀비 제외)`,
      });
    }
    if (
      agent.total >= thresholds.minTotal &&
      agent.retryRate > thresholds.retryRate
    ) {
      const percent = Math.round(agent.retryRate * 100);
      anomalies.push({
        scope: 'agent',
        key: agent.agentType,
        kind: 'RETRY_RATE',
        detail: `재시도율 ${percent}% (${agent.retries}/${agent.total})`,
      });
    }
    if (agent.sweptCount > 0) {
      anomalies.push({
        scope: 'agent',
        key: agent.agentType,
        kind: 'ZOMBIE',
        detail: `좀비 ${agent.sweptCount}건 정리됨`,
      });
    }
  }

  for (const preview of profiles.previews) {
    if (
      preview.total >= thresholds.minPreviewTotal &&
      preview.rejectRate > thresholds.previewRejectRate
    ) {
      const percent = Math.round(preview.rejectRate * 100);
      anomalies.push({
        scope: 'preview',
        key: preview.kind,
        kind: 'PREVIEW_REJECT',
        detail: `반려율 ${percent}% (취소 ${preview.cancelled}·만료 ${preview.expired}/${preview.total})`,
      });
    }
  }

  return anomalies;
};
