import { PoShadowFinding, PoShadowReport } from '../po-shadow.type';

// 원장(`agent_run.output`)에 저장된 PoShadowReport 를 안전하게 narrow 한다.
//
// `isPoShadowReportShape` 를 재사용하면 안 된다 — 그것은 **모델 출력 전용** 가드라
// `quiet === false`, `factSummary` 빈 배열, `droppedFindingCount === 0`,
// `degradedSources` 빈 배열을 요구하는데 저장분은 넷을 전부 위반한다(quiet 회차는 quiet=true 이고
// 두 배열이 코드로 채워진다). 그대로 쓰면 회수가 예외도 로그도 없이 영구히 0건이 된다.
//
// 회수 경로가 필요로 하는 것은 `findings[].factIds` 뿐이므로 그것만 요구한다.
// PM 쪽 `coerceToDailyPlan` 과 같은 역할이다.
export const coerceToPoShadowReport = (
  value: unknown,
): PoShadowReport | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isFindingArray(record.findings)) {
    return null;
  }
  return record as unknown as PoShadowReport;
};

// 저장된 리포트에서 회수 대조에 쓸 factId 를 모은다.
export const collectStoredFactIds = (value: unknown): string[] => {
  const report = coerceToPoShadowReport(value);
  if (report === null) {
    return [];
  }
  return report.findings.flatMap((finding) => finding.factIds);
};

// 저장된 리포트에 특정 열화 라벨이 있는지 본다. 주간 지표가 대조 불가 회차를 세는 데 쓴다.
// `findings` 형태를 요구하지 않는다 — 라벨만 필요한데 인용이 깨진 회차를 놓치면 비율이 낮게 나온다.
export const hasDegradedSource = (value: unknown, label: string): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.degradedSources) &&
    record.degradedSources.includes(label)
  );
};

const isFindingArray = (value: unknown): value is PoShadowFinding[] => {
  return Array.isArray(value) && value.every(isFindingShape);
};

const isFindingShape = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.factIds) &&
    record.factIds.every((factId) => typeof factId === 'string')
  );
};
