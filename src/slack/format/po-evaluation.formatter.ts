import { EvaluationOutput } from '../../agent/po-eval/domain/po-eval.type';

// PO 통합 facade 답글 formatter.
// 구조:
//   *📊 PO 통합 평가 — {range}*
//   _요약: {summary}_
//
//   *🏆 Wins*
//   • ...
//
//   *🚧 Blockers*
//   • ...
//
//   *💼 이력서용 careerLog ({period}, schemaVersion=1)*
//   *정량 성과*
//   • ...
//   *정성 성과*
//   • ...
//   *기술 스택*: NestJS, Prisma, ...
//   _Impact_: {impact}
//
//   _합성 source: workReviewer=#X, poShadow=#Y, impactReporter=#Z (missing: ...)_
export const formatEvaluationOutput = (output: EvaluationOutput): string => {
  const lines: string[] = [];
  const rangeLabel = output.range === 'WEEK' ? '최근 7일' : '최근 24시간';
  lines.push(`*📊 PO 통합 평가 — ${rangeLabel}*`);
  if (output.qualitative.summary.trim().length > 0) {
    lines.push('');
    lines.push(`_${escapeSlackMrkdwn(output.qualitative.summary)}_`);
  }

  if (output.qualitative.wins.length > 0) {
    lines.push('');
    lines.push('*🏆 Wins*');
    for (const item of output.qualitative.wins) {
      lines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (output.qualitative.blockers.length > 0) {
    lines.push('');
    lines.push('*🚧 Blockers*');
    for (const item of output.qualitative.blockers) {
      lines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }

  const cl = output.careerLog;
  lines.push('');
  lines.push(
    `*💼 이력서용 careerLog — ${escapeSlackMrkdwn(cl.period)} (schemaVersion=${cl.schemaVersion})*`,
  );
  if (cl.achievements.quantitative.length > 0) {
    lines.push('');
    lines.push('*정량 성과*');
    for (const item of cl.achievements.quantitative) {
      lines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (cl.achievements.qualitative.length > 0) {
    lines.push('');
    lines.push('*정성 성과*');
    for (const item of cl.achievements.qualitative) {
      lines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (cl.technologies.length > 0) {
    lines.push('');
    lines.push(
      `*기술 스택*: ${cl.technologies.map(escapeSlackMrkdwn).join(', ')}`,
    );
  }
  if (cl.impact.trim().length > 0) {
    lines.push('');
    lines.push(`_Impact: ${escapeSlackMrkdwn(cl.impact)}_`);
  }

  lines.push('');
  lines.push(formatSourceFooter(output));
  return lines.join('\n');
};

const formatSourceFooter = (output: EvaluationOutput): string => {
  const refs = output.sourceAgentRuns;
  const parts: string[] = [];
  if (refs.workReviewerRunId !== undefined) {
    parts.push(`workReviewer=#${refs.workReviewerRunId}`);
  }
  if (refs.poShadowRunId !== undefined) {
    parts.push(`poShadow=#${refs.poShadowRunId}`);
  }
  if (refs.impactReporterRunId !== undefined) {
    parts.push(`impactReporter=#${refs.impactReporterRunId}`);
  }
  const missing: string[] = [];
  if (refs.workReviewerRunId === undefined) {
    missing.push('workReviewer');
  }
  if (refs.poShadowRunId === undefined) {
    missing.push('poShadow');
  }
  if (refs.impactReporterRunId === undefined) {
    missing.push('impactReporter');
  }
  const sourcePart = parts.length > 0 ? parts.join(', ') : '(없음)';
  const missingPart =
    missing.length > 0 ? ` · missing: ${missing.join(', ')}` : '';
  return `_합성 source: ${sourcePart}${missingPart}_`;
};

const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
