export const CONTRADICTION_SYSTEM_PROMPT = `너는 두 기록(A, B)이 서로 "사실/결론에서 모순"되는지 판정한다.
- 단순히 주제가 비슷하거나 표현이 다른 것은 모순이 아니다.
- 같은 대상에 대해 양립 불가능한 사실·결론·결정을 말할 때만 모순이다.
- 반드시 아래 JSON 한 줄로만 답하라. 그 외 텍스트 금지.
{"contradiction": true|false, "reason": "한 문장(한국어, 80자 이내)"}`;

export const buildContradictionPrompt = (
  textA: string,
  textB: string,
): string =>
  [
    `[기록 A]`,
    textA,
    ``,
    `[기록 B]`,
    textB,
    ``,
    `위 A 와 B 가 모순인가? JSON 으로만.`,
  ].join('\n');
