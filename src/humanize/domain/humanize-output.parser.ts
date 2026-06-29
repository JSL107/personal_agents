// 윤문 LLM 출력(JSON)을 파싱해 expectedKeys 와 정확히 일치하는 string 맵으로 검증한다.
// 불일치/파싱 실패는 throw — 호출자(HumanizeService)가 catch 해 원본으로 fallback 한다.
export const parseHumanizeOutput = (
  rawText: string,
  expectedKeys: string[],
): Record<string, string> => {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error('윤문 출력이 JSON 이 아닙니다.');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('윤문 출력이 객체가 아닙니다.');
  }

  const record = parsed as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (actualKeys.length !== expectedKeys.length) {
    throw new Error('윤문 출력 키 개수가 입력과 다릅니다.');
  }

  const result: Record<string, string> = {};
  for (const key of expectedKeys) {
    const value = record[key];
    if (typeof value !== 'string') {
      throw new Error(
        `윤문 출력 키 '${key}' 가 누락되었거나 string 이 아닙니다.`,
      );
    }
    result[key] = value;
  }
  return result;
};
