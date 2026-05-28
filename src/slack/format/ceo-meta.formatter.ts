import { MetaOutput } from '../../agent/ceo/domain/ceo.type';

// CEO worker (P5 Meta) Slack 답글 formatter.
// 구조:
//   *🧭 CEO 메타 review — {range}*
//   _{finalSummary}_
//
//   *🌪️ 컨텍스트 드리프트 관찰*
//   • ...
//
//   *📚 문서 품질 관찰*
//   • ...
//
//   _합성 source: poEval=#X, pm=#Y, cto=#Z (missing: ...)_
export const formatCeoMetaOutput = (output: MetaOutput): string => {
  const lines: string[] = [];
  const rangeLabel = output.range === 'WEEK' ? '최근 7일' : '최근 24시간';
  lines.push(`*🧭 CEO 메타 review — ${rangeLabel}*`);
  if (output.finalSummary.trim().length > 0) {
    lines.push('');
    lines.push(`_${escapeSlackMrkdwn(output.finalSummary)}_`);
  }

  lines.push('');
  lines.push('*🌪️ 컨텍스트 드리프트 관찰*');
  if (output.contextDriftReport.observations.length > 0) {
    for (const item of output.contextDriftReport.observations) {
      lines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  } else {
    lines.push('_관찰된 drift 신호 없음._');
  }

  lines.push('');
  lines.push('*📚 문서 품질 관찰*');
  if (output.docsQualityReport.findings.length > 0) {
    for (const item of output.docsQualityReport.findings) {
      lines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  } else {
    lines.push('_본 주간 문서 관찰 없음._');
  }

  lines.push('');
  lines.push(formatSourceFooter(output));
  return lines.join('\n');
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
