import { redactPii } from '../../common/util/pii-redaction.util';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';

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
  action,
  expiredPrevious,
}: {
  label: string;
  cause: string | null;
  nextRunAt: string | null;
  action?: string | null;
  expiredPrevious?: boolean;
}): string =>
  [
    `🔴 *${label}* 작업이 멈췄어요`,
    `원인: ${cause ? `${cause} (추정)` : '확인 중'}`,
    `지금 상태: ${nextRunAt ? `${nextRunAt}에 다시 시도해요.` : '다시 시도할 시간을 확인하고 있어요.'}`,
    ...(action ? [`조치: ${action}`] : []),
    ...(expiredPrevious
      ? ['이전 사건은 24시간 재발이 없어 닫았어요 (해결 확인은 아님)']
      : []),
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
    `🔁 *${label}* 작업이 아직 멈춰 있어요`,
    `${dayCount}일째, ${occurrences}번 발생했어요.`,
    `원인: ${cause ? `${cause} (추정)` : '확인 중'}`,
  ].join('\n');

export const formatIncidentResolved = ({
  label,
  duration,
  occurrences,
  causes,
}: {
  label: string;
  duration: string;
  occurrences: number;
  causes?: string[];
}): string =>
  [
    `✅ *${label}* 작업이 복구됐어요`,
    ...(causes
      ?.map(describeIncidentCause)
      .filter((cause): cause is string => cause !== null).length
      ? [
          `원인: ${[...new Set(causes.map(describeIncidentCause).filter((cause): cause is string => cause !== null))].join(', ')}`,
        ]
      : []),
    `${duration} 동안 ${occurrences}번 발생했어요.`,
  ].join('\n');

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
  const redactedError = redactPii(errorMessage).slice(0, 1500);
  const content = [
    `대상: ${feature}`,
    `오류: ${redactedError}`,
    ...(files.length ? [`파일: ${files.join(', ')}`] : []),
    ...(checkCommand ? [`확인 명령: ${checkCommand}`] : []),
  ].join('\n');
  return `AI에 맡길 때 아래 내용을 복사하세요.\n\`\`\`\n${escapeSlackMrkdwn(redactPii(content).replace(/```/g, "'''"))}\n\`\`\``;
};
