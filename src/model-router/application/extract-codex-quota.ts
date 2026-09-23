import { CodexQuotaExceededException } from '../infrastructure/codex-cli.provider';

// 쿼터 소진은 래핑돼 올라오는 경우가 있어 cause 체인을 훑는다. 쿼터를 일반 실패로
// 삼키면 호출부가 재시도로 오해하므로 원형을 찾아 그대로 던지게 한다.
//
// model-router 소속인 이유: 훑는 키(`cause`·`primaryError`·`lastError`)가 이 모듈의
// `wrapCompletionFailed` 가 만드는 래핑 형태 그대로다(model-router.usecase.ts 의
// `cause: primaryError ? { primaryError, lastError } : lastError`). 찾는 예외도 이 모듈의
// 것이다. 세 기능 모듈(review-reply-judge · pr-review-loop · humanize)이 이 판별을 쓰므로
// 특정 기능 안에 두면 나머지가 남의 내부 구현에 의존하게 된다.
export const extractCodexQuota = (
  error: unknown,
): CodexQuotaExceededException | null => {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current instanceof CodexQuotaExceededException) {
      return current;
    }
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      stack.push(record.cause, record.primaryError, record.lastError);
    }
  }
  return null;
};
