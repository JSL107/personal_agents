// LLM 응답 → { specCode: string } 파싱.
// raw JSON / ```json fence / plain text fallback 순서로 시도한다.
// 파싱 실패 시에도 specCode 에 원문을 보존해 Slack 응답이 끊기지 않게 한다.
export const parseSpecCode = (text: string): { specCode: string } => {
  const fenceMatch = text.match(/```(?:json|typescript|ts)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();

  const parsed = tryParseJson(candidate);
  if (
    parsed &&
    typeof parsed.specCode === 'string' &&
    parsed.specCode.length > 0
  ) {
    return { specCode: parsed.specCode };
  }

  // LLM 이 specCode plain text 로만 응답한 경우 — TypeScript 코드처럼 보이면 그대로 수용.
  if (looksLikeTypeScript(candidate)) {
    return { specCode: candidate };
  }

  // 최후 fallback — 원문 보존.
  return { specCode: text.trim() };
};

const tryParseJson = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};

// describe( / it( / import 중 하나라도 있으면 TypeScript 코드로 판단.
const looksLikeTypeScript = (text: string): boolean =>
  /\b(describe|it|import|test)\s*\(/.test(text);
