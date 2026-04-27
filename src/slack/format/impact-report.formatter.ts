import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';

// /impact-report 결과 — 임팩트 보고서를 한국어 Slack 마크다운으로 렌더.
export const formatImpactReport = (report: ImpactReport): string => {
  const lines: string[] = [
    `*임팩트 보고서* — ${report.subject}`,
    '',
    `📌 *Headline*: ${report.headline}`,
    '',
  ];

  if (report.quantitative.length > 0) {
    lines.push(
      '*정량 근거*',
      ...report.quantitative.map((item) => `• ${item}`),
      '',
    );
  }

  lines.push('*질적 영향*', report.qualitative, '');

  const renderArea = (label: string, items: string[]): void => {
    if (items.length === 0) {
      return;
    }
    lines.push(`*${label}*`, ...items.map((i) => `• ${i}`), '');
  };
  renderArea('사용자 영향', report.affectedAreas.users);
  renderArea('팀/협업 영향', report.affectedAreas.team);
  renderArea('서비스/시스템 영향', report.affectedAreas.service);

  if (report.beforeAfter) {
    lines.push(
      '*개선 전/후*',
      `• 개선 전: ${report.beforeAfter.before}`,
      `• 개선 후: ${report.beforeAfter.after}`,
      '',
    );
  }

  if (report.risks.length > 0) {
    lines.push('*리스크*', ...report.risks.map((r) => `• ${r}`), '');
  }

  lines.push('*판단 근거*', report.reasoning);

  return lines.join('\n');
};
