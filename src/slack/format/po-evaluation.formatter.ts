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
// `quantitativeShownElsewhere` — 같은 메시지의 다른 스레드 댓글(저녁 업무 회고 「정량 근거」)이
// 이미 숫자를 싣고 있을 때만 켠다. `isShown` 이 참인 항목만 「정량 성과」에서 빼고 몇 건을 뺐는지
// 한 줄로 알린다 — 업무 회고에 없던 항목은 그대로 남는다. 화면 배치만 바꾼다(careerLog 원장·저장
// 형태는 그대로). 미지정이면 종전 출력.
export interface FormatEvaluationOptions {
  quantitativeShownElsewhere?: {
    workReviewerRunId: number;
    isShown: (item: string) => boolean;
  };
}

export const formatEvaluationOutput = (
  output: EvaluationOutput,
  options: FormatEvaluationOptions = {},
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
  const shownElsewhere = options.quantitativeShownElsewhere;
  const quantitative = shownElsewhere
    ? cl.achievements.quantitative.filter(
        (item) => !shownElsewhere.isShown(item),
      )
    : cl.achievements.quantitative;
  const omittedCount =
    cl.achievements.quantitative.length - quantitative.length;
  if (quantitative.length > 0) {
    detailLines.push('');
    detailLines.push('*정량 성과*');
    for (const item of quantitative) {
      detailLines.push(`• ${escapeSlackMrkdwn(item)}`);
    }
  }
  if (shownElsewhere && omittedCount > 0) {
    detailLines.push('');
    detailLines.push(
      `_정량 성과 ${omittedCount}건은 업무 회고(run #${shownElsewhere.workReviewerRunId}) 「정량 근거」와 같은 숫자라 여기서는 생략합니다._`,
    );
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
