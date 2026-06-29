import { MetaOutput } from '../../agent/ceo/domain/ceo.type';
import { FormattedReport } from './formatted-report.type';

// CEO worker (P5 Meta) Slack 답글 formatter.
// summary:
//   *🧭 CEO 메타 review — {range}*
//   _{finalSummary}_
//
// detail:
//   *🌪️ 컨텍스트 드리프트 관찰*
//   • ...
//
//   *📚 문서 품질 관찰*
//   • ...
//
//   _합성 source: poEval=#X, pm=#Y, cto=#Z (missing: ...)_
export const formatCeoMetaOutput = (output: MetaOutput): FormattedReport => {
  const rangeLabel = output.range === 'WEEK' ? '최근 7일' : '최근 24시간';

  const summaryLines: string[] = [];
  summaryLines.push(`*🧭 CEO 메타 review — ${rangeLabel}*`);
  if (output.finalSummary.trim().length > 0) {
    summaryLines.push('');
    summaryLines.push(`_${escapeSlackMrkdwn(output.finalSummary)}_`);
  }

  const detailLines: string[] = [];
  detailLines.push('*🌪️ 컨텍스트 드리프트 관찰*');
  if (output.contextDriftReport.observations.length > 0) {
    for (const item of output.contextDriftReport.observations) {
      detailLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  } else {
    detailLines.push('_관찰된 drift 신호 없음._');
  }

  detailLines.push('');
  detailLines.push('*📚 문서 품질 관찰*');
  if (output.docsQualityReport.findings.length > 0) {
    for (const item of output.docsQualityReport.findings) {
      detailLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  } else {
    detailLines.push('_본 주간 문서 관찰 없음._');
  }

  detailLines.push('');
  detailLines.push(formatSourceFooter(output));

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.join('\n'),
  };
};

const formatSourceFooter = (output: MetaOutput): string => {
  const refs = output.sourcePhaseRuns;
  const parts: string[] = [`poEval=#${refs.poEvalRunId}`];
  const missing: string[] = [];
  if (refs.pmRunId !== undefined) {
    parts.push(`pm=#${refs.pmRunId}`);
  } else {
    missing.push('pm');
  }
  if (refs.ctoRunId !== undefined) {
    parts.push(`cto=#${refs.ctoRunId}`);
  } else {
    missing.push('cto');
  }
  const missingPart =
    missing.length > 0 ? ` · missing: ${missing.join(', ')}` : '';
  return `_합성 source: ${parts.join(', ')}${missingPart} (schemaVersion=${output.schemaVersion})_`;
};

const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
