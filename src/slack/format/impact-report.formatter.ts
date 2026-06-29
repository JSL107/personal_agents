import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { FormattedReport } from './formatted-report.type';

// summary 핵심 근거 불릿 상한.
const SUMMARY_QUANT_LIMIT = 3;

// /impact-report 결과 — summary(헤드라인+핵심) / detail(전체 섹션) 로 분리 렌더.
export const formatImpactReport = (report: ImpactReport): FormattedReport => {
  const summaryLines: string[] = [
    `*임팩트 보고서* — ${report.subject}`,
    '',
    `📌 *Headline*: ${report.headline}`,
  ];
  if (report.quantitative.length > 0) {
    summaryLines.push(
      '',
      '*핵심 근거*',
      ...report.quantitative
        .slice(0, SUMMARY_QUANT_LIMIT)
        .map((item) => `• ${item}`),
    );
  }

  const detailLines: string[] = [];
  if (report.quantitative.length > 0) {
    detailLines.push(
      '*정량 근거*',
      ...report.quantitative.map((item) => `• ${item}`),
      '',
    );
  }
  detailLines.push('*질적 영향*', report.qualitative, '');

  const renderArea = (label: string, items: string[]): void => {
    if (items.length === 0) {
      return;
    }
    detailLines.push(`*${label}*`, ...items.map((item) => `• ${item}`), '');
  };
  renderArea('사용자 영향', report.affectedAreas.users);
  renderArea('팀/협업 영향', report.affectedAreas.team);
  renderArea('서비스/시스템 영향', report.affectedAreas.service);

  if (report.beforeAfter) {
    detailLines.push(
      '*개선 전/후*',
      `• 개선 전: ${report.beforeAfter.before}`,
      `• 개선 후: ${report.beforeAfter.after}`,
      '',
    );
  }
  if (report.risks.length > 0) {
    detailLines.push(
      '*리스크*',
      ...report.risks.map((item) => `• ${item}`),
      '',
    );
  }
  detailLines.push('*판단 근거*', report.reasoning);

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.join('\n'),
  };
};
