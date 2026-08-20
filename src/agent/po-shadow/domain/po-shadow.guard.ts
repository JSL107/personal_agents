import { PlanRealityFact } from './plan-reality.diff';
import { PoShadowFinding, PoShadowReport } from './po-shadow.type';

export const guardPoShadowReport = (
  report: PoShadowReport,
  facts: PlanRealityFact[],
): PoShadowReport => {
  const validFactIds = new Set(facts.map((fact) => fact.id));
  const findings: PoShadowFinding[] = [];
  let removedFindingCount = 0;

  for (const finding of report.findings) {
    const factIds = finding.factIds.filter((factId) =>
      validFactIds.has(factId),
    );
    if (factIds.length === 0) {
      removedFindingCount += 1;
      continue;
    }
    if (factIds.length === finding.factIds.length) {
      findings.push(finding);
      continue;
    }
    findings.push({ ...finding, factIds });
  }

  const droppedFindingCount = report.droppedFindingCount + removedFindingCount;
  // headline 과 purposeConflict 에는 인용 근거가 없다. 지적이 전부 근거 없이 버려졌다면
  // 그 둘만 살아남아 카드의 가장 눈에 띄는 자리에 근거 없는 문장이 남는다 — 같은 환각이
  // "먼저 이것부터" 로 올라가는 셈이라, 근거를 잃은 회차에는 코드가 문장을 도로 가져간다.
  if (findings.length === 0 && removedFindingCount > 0) {
    return {
      ...report,
      findings,
      headline: '근거를 확인하지 못해 지적을 내지 않습니다',
      purposeConflict: null,
      droppedFindingCount,
    };
  }

  return {
    ...report,
    findings,
    droppedFindingCount,
  };
};
