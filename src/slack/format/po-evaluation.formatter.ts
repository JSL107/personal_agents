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

// PO 통합 facade 답글 formatter — summary(메인 메시지) / detail(스레드 상세 = 근거) 로 분리 렌더.
// summary(메인):
//   *📊 PO 통합 평가 — {range}*
//   _{summary}_
//   *🏆 잘된 것* / *🚧 막힌 것*
// detail(스레드 = 근거):
//   *💼 이력서용 careerLog ({period}, schemaVersion=1)*
//   *정량 성과* / *정성 성과* / *기술 스택* / _Impact_
//   _합성 source: workReviewer=#X, poShadow=#Y, impactReporter=#Z (missing: ...)_
// `quantitativeShownElsewhere` — 같은 메시지의 다른 스레드 댓글(저녁 업무 회고 「정량 근거」)이
// 이미 숫자를 싣고 있을 때만 켠다. `isShown` 이 참인 항목만 「정량 성과」에서 빼고 몇 건을 뺐는지
// 한 줄로 알린다 — 업무 회고에 없던 항목은 그대로 남는다. 화면 배치만 바꾼다(careerLog 원장·저장
// 형태는 그대로). 미지정이면 종전 출력.
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

  return {
    summary: summaryLines.join('\n'),
    detail: '',
  };
};
