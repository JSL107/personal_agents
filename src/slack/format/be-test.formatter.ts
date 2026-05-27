import { GeneratedTest } from '../../agent/be-test/domain/be-test.type';

// spec 코드가 길면 200줄로 cap — Slack 메시지 길이 한도 방어.
const SPEC_LINES_CAP = 200;
// stderr tail 도 너무 길면 Slack 한도 초과 — 추가 cap.
const STDERR_LINES_CAP = 30;

// /be-test 응답 포매터.
// specCode 는 ```ts fence 안에 노출 — LLM 출력이라 mrkdwn 위조 차단을 위해 fence 활용.
// 나머지 free-text 는 escapeSlackMrkdwn 로 sanitize.
//
// V3 §8 self-correction 단계 3 — validated true/false 분기를 사용자에게 직접 노출.
export const formatGeneratedTest = (test: GeneratedTest): string => {
  const lines: string[] = [];

  lines.push(`*🧪 BE-Test 결과 — ${escapeSlackMrkdwn(test.filePath)}*`);
  lines.push('');
  lines.push(formatValidationBadge(test));
  lines.push('');

  if (test.specCode.trim().length > 0) {
    const specLines = test.specCode.split('\n');
    const capped = specLines.slice(0, SPEC_LINES_CAP);
    const remaining = specLines.length - capped.length;

    lines.push('*생성된 spec 코드*');
    lines.push('```ts');
    lines.push(capped.join('\n'));
    lines.push('```');

    if (remaining > 0) {
      lines.push(`_(+${remaining}줄 생략)_`);
    }
  }

  if (!test.validated && test.selfCorrectionStderrTail) {
    const stderrLines = test.selfCorrectionStderrTail.split('\n');
    const cappedStderr = stderrLines.slice(-STDERR_LINES_CAP);
    lines.push('');
    lines.push('*Sandbox stderr (tail)*');
    lines.push('```');
    lines.push(escapeSlackMrkdwn(cappedStderr.join('\n')));
    lines.push('```');
  }

  return lines.join('\n');
};

const formatValidationBadge = (test: GeneratedTest): string => {
  if (test.validated) {
    return `✅ Sandbox 검증 통과 — attempts=${test.selfCorrectionAttempts}`;
  }
  const reason = test.selfCorrectionStopReason ?? 'UNKNOWN';
  const attempts = test.selfCorrectionAttempts;
  switch (reason) {
    case 'MAX_ATTEMPTS_EXHAUSTED':
      return `⚠️ 검증 실패 — ${attempts}회 retry 후에도 통과 X. 수동 검토 필요`;
    case 'NON_RETRYABLE':
      return `⚠️ 검증 실패 — assertion fail 패턴 감지 (attempts=${attempts}). 동일 구조 재생성 가치 낮아 조기 중단`;
    case 'SANDBOX_UNAVAILABLE':
      return `⚠️ Sandbox 사용 불가 — Docker daemon/이미지 점검 필요 (attempts=${attempts})`;
    default:
      return `⚠️ 검증 실패 — attempts=${attempts}, 사유 UNKNOWN`;
  }
};

// Slack mrkdwn control 문자 escape — LLM 출력을 통한 메시지 위조 차단.
const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
