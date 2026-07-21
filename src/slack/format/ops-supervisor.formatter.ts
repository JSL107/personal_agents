import {
  QualityAnomaly,
  QualityAnomalyKind,
} from '../../ops-supervisor/domain/ops-quality.anomaly';
import { QualityProfiles } from '../../ops-supervisor/domain/ops-quality.type';

const ICON: Record<QualityAnomalyKind, string> = {
  FAIL_RATE: '🔴',
  RETRY_RATE: '🔁',
  ZOMBIE: '🧟',
  PREVIEW_REJECT: '🙅',
};

// 이상 0건이면 1줄 하트비트, 있으면 항목과 codex 제안을 표시한다.
export const formatOpsSupervisor = (
  profiles: QualityProfiles,
  anomalies: QualityAnomaly[],
  suggestion: string | null,
  firedAtKst: string,
): string => {
  if (anomalies.length === 0) {
    const agentCount = profiles.agents.length;
    const previewCount = profiles.previews.length;
    return `✅ *운영 감독관* — ${firedAtKst} · 지난 30일 품질 이상 없음 (${agentCount}개 에이전트·${previewCount}개 preview 종류 점검)`;
  }

  const header = `🩺 *운영 감독관* — ${firedAtKst} · 품질 이상 ${anomalies.length}건 (최근 30일)`;
  const lines = anomalies.map(
    (item) => `• ${ICON[item.kind]} ${item.key}: ${item.detail}`,
  );
  const advice =
    suggestion !== null
      ? ['', '*개선 제안*', suggestion]
      : ['', '_개선 제안 생략 (codex 쿼터 소진)_'];

  return [header, ...lines, ...advice].join('\n');
};
