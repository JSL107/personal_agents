import {
  ConventionViolation,
  PrConventionReport,
} from '../../agent/be-fix/domain/be-fix.type';

// /be-fix 응답 포매터.
// LLM 출력 (message, suggestedFix, summary) 은 prompt-injection 위험이 있어 escape 적용.
// suggestedFix 는 코드 fence 안이라 mrkdwn 비활성화되지만, fence 구분자 밖 텍스트는 escape.
const VIOLATIONS_DISPLAY_LIMIT = 10;
const MESSAGE_CAP = 3_000; // Slack 메시지 hard cap 에 여유 두기

export const formatPrConventionReport = (
  report: PrConventionReport,
): string => {
  const lines: string[] = [];

  lines.push(`*🔧 BE-Fix — ${escapeSlack(report.prRef)}*`);

  if (report.prTitle.trim().length > 0) {
    lines.push(escapeSlack(report.prTitle.trim()));
  }

  lines.push('');

  if (report.parseError) {
    lines.push('_(LLM 응답 파싱에 실패했습니다. 아래는 원문 요약입니다.)_');
    lines.push('');
  }

  if (report.violations.length === 0) {
    lines.push('✅ 컨벤션 통과 — 위반 사항 없음');
  } else {
    const shown = report.violations.slice(0, VIOLATIONS_DISPLAY_LIMIT);
    const remaining = report.violations.length - shown.length;

    for (const v of shown) {
      lines.push(formatViolation(v));
    }

    if (remaining > 0) {
      lines.push(`_(${remaining}건 추가 위반 생략)_`);
    }
  }

  if (report.summary.trim().length > 0) {
    lines.push('');
    lines.push(`_${escapeSlack(report.summary.trim())}_`);
  }

  const result = lines.join('\n');
  if (result.length > MESSAGE_CAP) {
    return result.slice(0, MESSAGE_CAP) + '\n_(메시지가 너무 길어 잘렸습니다)_';
  }
  return result;
};

const formatViolation = (v: ConventionViolation): string => {
  const location = v.line != null ? `:${v.line}` : '';
  const header = `*[${v.category}]* \`${escapeSlack(v.filePath)}${location}\` — ${escapeSlack(v.message)}`;

  if (v.suggestedFix.trim().length === 0) {
    return header;
  }

  // suggestedFix 가 이미 코드 fence 를 포함할 수 있다.
  // 포함하지 않으면 ts fence 로 감싼다.
  const fix = v.suggestedFix.trim();
  const fixBlock = fix.startsWith('```') ? fix : '```ts\n' + fix + '\n```';

  return [header, fixBlock].join('\n');
};

// Slack mrkdwn control 문자(<, >, &) escape.
const escapeSlack = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
