import { GeneratedTest } from '../../agent/be-test/domain/be-test.type';

// spec 코드가 길면 200줄로 cap — Slack 메시지 길이 한도 방어.
const SPEC_LINES_CAP = 200;

// /be-test 응답 포매터.
// specCode 는 ```ts fence 안에 노출 — LLM 출력이라 mrkdwn 위조 차단을 위해 fence 활용.
// 나머지 free-text 는 escapeSlackMrkdwn 로 sanitize.
//
// MVP 는 sandbox 검증을 수행하지 않고 spec 코드만 반환한다 (audit codex P1 — 호스트 fs 위험 회피).
// 사용자가 직접 검증하는 흐름이므로 안내 문구로 명시.
export const formatGeneratedTest = (test: GeneratedTest): string => {
  const lines: string[] = [];

  lines.push(`*🧪 BE-Test 결과 — ${escapeSlackMrkdwn(test.filePath)}*`);
  lines.push('');
  lines.push(
    'ℹ️ MVP 단계 — sandbox 자동 검증은 비활성화 (보안 점검 후 단계적 도입). 생성된 spec 을 로컬에서 직접 실행해 검증해주세요.',
  );
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

  return lines.join('\n');
};

// Slack mrkdwn control 문자 escape — LLM 출력을 통한 메시지 위조 차단.
const escapeSlackMrkdwn = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
