import { EvaluationOutput } from '../../agent/po-eval/domain/po-eval.type';
import { FormattedReport } from './formatted-report.type';

// PO 통합 facade 답글 formatter — summary(메인 메시지) / detail(스레드 상세 = 근거) 로 분리 렌더.
// summary(메인):
//   *📊 PO 통합 평가 — {range}*
//   _{summary}_
//   *🏆 Wins* / *🚧 Blockers*
// detail(스레드 = 근거):
//   *💼 이력서용 careerLog ({period}, schemaVersion=1)*
//   *정량 성과* / *정성 성과* / *기술 스택* / _Impact_
//   _합성 source: workReviewer=#X, poShadow=#Y, impactReporter=#Z (missing: ...)_
export const formatEvaluationOutput = (
  output: EvaluationOutput,
): FormattedReport => {
  const rangeLabel = output.range === 'WEEK' ? '최근 7일' : '최근 24시간';
  const summaryLines: string[] = [`*📊 PO 통합 평가 — ${rangeLabel}*`];
  if (output.qualitative.summary.trim().length > 0) {
    summaryLines.push('');
    summaryLines.push(`_${escapeSlackMrkdwn(output.qualitative.summary)}_`);
  }
  if (output.qualitative.wins.length > 0) {
    summaryLines.push('');
    summaryLines.push('*🏆 Wins*');
    for (const item of output.qualitative.wins) {
      summaryLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (output.qualitative.blockers.length > 0) {
    summaryLines.push('');
    summaryLines.push('*🚧 Blockers*');
    for (const item of output.qualitative.blockers) {
      summaryLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }

  const cl = output.careerLog;
  const detailLines: string[] = [
    `*💼 이력서용 careerLog — ${escapeSlackMrkdwn(cl.period)} (schemaVersion=${cl.schemaVersion})*`,
  ];
  if (cl.achievements.quantitative.length > 0) {
    detailLines.push('');
    detailLines.push('*정량 성과*');
    for (const item of cl.achievements.quantitative) {
      detailLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (cl.achievements.qualitative.length > 0) {
    detailLines.push('');
    detailLines.push('*정성 성과*');
    for (const item of cl.achievements.qualitative) {
      detailLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (cl.technologies.length > 0) {
    detailLines.push('');
    detailLines.push(
      `*기술 스택*: ${cl.technologies.map(escapeSlackMrkdwn).join(', ')}`,
    );
  }
  if (cl.impact.trim().length > 0) {
    detailLines.push('');
    detailLines.push(`_Impact: ${escapeSlackMrkdwn(cl.impact)}_`);
  }

  detailLines.push('');
  detailLines.push(formatSourceFooter(output));

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.join('\n'),
  };
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
