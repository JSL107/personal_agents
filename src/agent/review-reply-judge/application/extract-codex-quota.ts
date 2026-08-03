import { CodexQuotaExceededException } from '../../../model-router/infrastructure/codex-cli.provider';

// 쿼터 소진은 래핑돼 올라오는 경우가 있어 cause 체인을 훑는다. 쿼터를 일반 실패로
// 삼키면 호출부가 재시도로 오해하므로 원형을 찾아 그대로 던지게 한다.
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
