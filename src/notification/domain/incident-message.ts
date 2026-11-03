import { redactPii } from '../../common/util/pii-redaction.util';

export const describeIncidentCause = (errorMessage: string): string | null => {
  if (/Not logged in|401|unauthorized|token.*expired/i.test(errorMessage)) {
    return '로그인이 만료된 것 같아요';
  }
  if (/quota|rate limit|429/i.test(errorMessage)) {
    return '사용량 한도에 걸렸어요';
  }
  if (/timeout|timed out|ETIMEDOUT/i.test(errorMessage)) {
    return '응답 시간이 초과됐어요';
  }
  if (/ECONNREFUSED|ENOTFOUND|socket hang up/i.test(errorMessage)) {
    return '연결이 끊겼어요';
  }
  return null;
};

export const formatIncidentOpen = ({
  label,
  cause,
  nextRunAt,
}: {
  label: string;
  cause: string | null;
  nextRunAt: string | null;
}): string =>
  [
    `🔴 *${label}이 멈췄어요*`,
    `원인: ${cause ? `${cause} (추정)` : '확인 중'}`,
    `지금 상태: ${nextRunAt ? `${nextRunAt}에 다시 시도해요.` : '다시 시도할 시간을 확인하고 있어요.'}`,
  ].join('\n');

export const formatIncidentRemind = ({
  label,
  dayCount,
  occurrences,
  cause,
}: {
  label: string;
  dayCount: number;
  occurrences: number;
  cause: string | null;
}): string =>
  [
    `🔁 *${label}이 아직 멈춰 있어요*`,
    `${dayCount}일째, ${occurrences}번 발생했어요.`,
    `원인: ${cause ? `${cause} (추정)` : '확인 중'}`,
  ].join('\n');

export const formatIncidentResolved = ({
  label,
  duration,
  occurrences,
}: {
  label: string;
  duration: string;
  occurrences: number;
}): string =>
  `✅ *${label}이 복구됐어요*\n${duration} 동안 ${occurrences}번 발생했어요.`;

export const formatAiHandoff = ({
  feature,
  errorMessage,
  files,
  checkCommand,
}: {
  feature: string;
  errorMessage: string;
  files: string[];
  checkCommand: string | null;
}): string => {
  const content = [
    `대상: ${feature}`,
    `오류: ${errorMessage}`,
    ...(files.length ? [`파일: ${files.join(', ')}`] : []),
    ...(checkCommand ? [`확인 명령: ${checkCommand}`] : []),
  ].join('\n');
  return `AI에 맡길 때 아래 내용을 복사하세요.\n\`\`\`\n${redactPii(content).replace(/```/g, "'''")}\n\`\`\``;
};
