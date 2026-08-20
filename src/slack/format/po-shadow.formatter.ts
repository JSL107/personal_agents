import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

// 조회하지 못한 소스는 조용한 날에도, 지적이 있는 날에도 그대로 밝힌다. "이상 없음" 과
// "못 봤음" 이 같은 글자로 나가면 카드가 조용한 고장을 덮는다.
export const formatPoShadowReport = (report: PoShadowReport): string => {
  if (report.quiet) {
    return formatQuietReport(report);
  }

  const sections = [
    '*PO 검토*',
    `🎯 *먼저 이것부터* ${escapeSlackMrkdwn(report.headline)}`,
  ];

  if (report.findings.length > 0) {
    sections.push(formatFindings(report));
  } else if (report.factSummary.length > 0) {
    sections.push(formatEvidenceLines(report.factSummary));
  }

  const purposeConflict = report.purposeConflict?.trim();
  if (purposeConflict) {
    sections.push(`⚠️ *1순위와 어긋남* ${escapeSlackMrkdwn(purposeConflict)}`);
  }

  if (report.droppedFindingCount > 0) {
    sections.push(
      `_근거 없는 지적 ${report.droppedFindingCount}건은 제외했습니다._`,
    );
  }

  const degradedLine = formatDegradedLine(report.degradedSources);
  if (degradedLine) {
    sections.push(degradedLine);
  }

  return sections.join('\n\n');
};

const formatDegradedLine = (degradedSources: string[]): string | null => {
  if (degradedSources.length === 0) {
    return null;
  }
  const escapedSources = degradedSources.map(escapeSlackMrkdwn).join(' · ');
  return `⚠️ _${escapedSources} 조회 실패 — 이 회차는 해당 근거 없이 판단했습니다._`;
};

const formatQuietReport = (report: PoShadowReport): string => {
  const escapedFacts = report.factSummary.map(escapeSlackMrkdwn);
  const headLine =
    escapedFacts.length === 0
      ? '✅ *PO 검토* — 계획대로 진행 중'
      : `✅ *PO 검토* — 계획대로 진행 중 (${escapedFacts.join(' · ')})`;
  const degradedLine = formatDegradedLine(report.degradedSources);
  if (!degradedLine) {
    return headLine;
  }
  return `${headLine}\n\n${degradedLine}`;
};

const formatFindings = (report: PoShadowReport): string =>
  report.findings
    .map((finding, index) => {
      const point = escapeSlackMrkdwn(finding.point);
      const suggestion = escapeSlackMrkdwn(finding.suggestion);
      const findingLine = `• ${point} — ${suggestion}`;
      const fact = report.factSummary[index];
      if (fact === undefined) {
        return findingLine;
      }
      return `${findingLine}\n  ↳ 근거: ${escapeSlackMrkdwn(fact)}`;
    })
    .join('\n');

const formatEvidenceLines = (factSummary: string[]): string =>
  factSummary.map((fact) => `  ↳ 근거: ${escapeSlackMrkdwn(fact)}`).join('\n');
