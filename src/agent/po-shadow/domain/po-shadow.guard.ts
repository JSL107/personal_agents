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

  return {
    ...report,
    findings,
    droppedFindingCount: report.droppedFindingCount + removedFindingCount,
  };
};
