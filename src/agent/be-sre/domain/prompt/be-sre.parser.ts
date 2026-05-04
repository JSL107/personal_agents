import { SreAnalysis } from '../be-sre.type';

type LlmDerivedFields = Pick<
  SreAnalysis,
  'rootCauseHypothesis' | 'patchProposal' | 'reasoning' | 'parseError'
>;

// LLM JSON 응답 → SreAnalysis 의 LLM-derived 필드 파싱.
// raw JSON / ```json fence / plain text fallback 순서로 시도한다.
// 파싱 실패 시 원문을 patchProposal 로 보존해 Slack 응답이 끊기지 않게 한다.
//
// raw JSON 를 먼저 시도하는 이유: patchProposal 값 안에 ```typescript fence 가 포함될 수 있어
// fence 정규식이 먼저 실행되면 JSON 내부 문자열을 잘못 추출한다.
export const parseSreAnalysis = (text: string): LlmDerivedFields => {
  const trimmed = text.trim();

  // 1단계: raw JSON 직접 시도.
  const direct = tryExtractFields(trimmed);
  if (direct) {
    return direct;
  }

  // 2단계: ```json fence 로 감싸진 경우.
  // patchProposal 값 안에 내부 ``` fence 가 포함될 수 있어 greedy 매칭으로 마지막 ``` 까지 확장한다.
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*)```\s*$/m);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    const fenced = tryExtractFields(inner);
    if (fenced) {
      return fenced;
    }
  }

  // 최후 fallback — 원문을 patchProposal 에 보존 + parseError 표시.
  return {
    rootCauseHypothesis: '',
    patchProposal: trimmed,
    reasoning: '',
    parseError: true,
  };
};

const tryExtractFields = (text: string): LlmDerivedFields | null => {
  const parsed = tryParseJson(text);
  if (
    parsed &&
    typeof parsed.rootCauseHypothesis === 'string' &&
    typeof parsed.patchProposal === 'string' &&
    typeof parsed.reasoning === 'string'
  ) {
    return {
      rootCauseHypothesis: parsed.rootCauseHypothesis,
      patchProposal: parsed.patchProposal,
      reasoning: parsed.reasoning,
    };
  }
  return null;
};

const tryParseJson = (text: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
};
