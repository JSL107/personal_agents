import { EvaluationOutput } from '../../agent/po-eval/domain/po-eval.type';
import { FormattedReport } from './formatted-report.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const readableText = (text: string): string =>
  escapeSlackMrkdwn(
    text
      .replace(/\s*—\s*/g, ', ')
      .replace(/\bPR\s*#\d+\b/gi, '코드 변경')
      .replace(/\bIssue\s*#\d+\b/gi, '작업')
      .replace(/이슈\s*#\d+\b/g, '작업')
      .replace(/(?<![\w(])#\d+\b/g, '해당 작업')
      .replace(/\b(?:codex|claude)(?:-cli)?\b/gi, '모델'),
  );

// PO 평가 요약은 본문에, 승인 시 Notion에 저장할 이력서 기록은 상세에 둔다.
export const formatEvaluationOutput = (
  output: EvaluationOutput,
): FormattedReport => {
  const rangeLabel = output.range === 'WEEK' ? '최근 7일' : '최근 24시간';
  const summaryLines: string[] = [`*📊 PO 통합 평가: ${rangeLabel}*`];
  if (output.qualitative.summary.trim().length > 0) {
    summaryLines.push('');
    summaryLines.push(`_${readableText(output.qualitative.summary)}_`);
  }
  if (output.qualitative.wins.length > 0) {
    summaryLines.push('');
    summaryLines.push('*🏆 잘된 것*');
    for (const item of output.qualitative.wins) {
      summaryLines.push(`• ${readableText(item)}`);
    }
  }
  if (output.qualitative.blockers.length > 0) {
    summaryLines.push('');
    summaryLines.push('*🚧 막힌 것*');
    for (const item of output.qualitative.blockers) {
      summaryLines.push(`• ${readableText(item)}`);
    }
  }

  const careerLog = output.careerLog;
  const detailLines = [
    `*💼 이력서 기록 초안 (${readableText(careerLog.period)})*`,
  ];
  const sections = [
    { label: '정량 성과', items: careerLog.achievements.quantitative },
    { label: '정성 성과', items: careerLog.achievements.qualitative },
    { label: '기술', items: careerLog.technologies },
  ];
  for (const section of sections) {
    if (section.items.length === 0) {
      continue;
    }
    detailLines.push('', `*${section.label}*`);
    detailLines.push(...section.items.map((item) => `• ${readableText(item)}`));
  }
  if (careerLog.impact.trim().length > 0) {
    detailLines.push('', '*영향*', readableText(careerLog.impact));
  }

  return {
    summary: summaryLines.join('\n'),
    detail: detailLines.join('\n'),
  };
};
