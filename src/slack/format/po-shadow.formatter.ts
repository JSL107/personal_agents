import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';

// /po-shadow 결과 — PO 시각의 검토를 한국어 Slack 마크다운으로 렌더.
export const formatPoShadowReport = (report: PoShadowReport): string => {
  const lines: string[] = [
    '*PO Shadow 검토*',
    '',
    `🎯 *우선순위 재점검*: ${report.priorityRecheck}`,
    '',
    `❓ *진짜 목적 재질문*: ${report.realPurposeQuestion}`,
    '',
  ];

  if (report.missingRequirements.length > 0) {
    lines.push(
      '*누락 가능 요구사항*',
      ...report.missingRequirements.map((r) => `• ${r}`),
      '',
    );
  }

  if (report.releaseRisks.length > 0) {
    lines.push(
      '*release 리스크*',
      ...report.releaseRisks.map((r) => `• ${r}`),
      '',
    );
  }

  lines.push('*권고*', report.recommendation);
  return lines.join('\n');
};
