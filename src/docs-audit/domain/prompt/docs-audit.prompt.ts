export const OPTIMIZER_SYSTEM_PROMPT =
  '당신은 코드(SoT)와 문서를 대조해 "문서가 코드와 의미적으로 어긋났는지" 판정하고, ' +
  '어긋났으면 문서를 고치는 최소 편집을 제안하는 기술 문서 검수자입니다. ' +
  '편집은 search/replace 형식 — oldString 은 대상 문서에 "정확히 한 번" 나타나는 부분 문자열이어야 하며(공백/개행 포함 그대로 복사), newString 은 그 치환입니다. ' +
  '코드 사실만 근거로 삼고 추측 금지. 반드시 아래 JSON 한 개만 출력합니다.\n' +
  '{"needsRevision": boolean, "edits": [{"oldString": string, "newString": string}], "rationale": string}';

export function buildOptimizerPrompt(input: {
  filePath: string;
  codeContext: string;
  docExcerpt: string;
  evaluatorFeedback?: string;
}): string {
  const feedback = input.evaluatorFeedback
    ? `\n\n[직전 평가자 피드백 — 이를 반영해 다시 제안]\n${input.evaluatorFeedback}`
    : '';
  return [
    `[대상 문서] ${input.filePath}`,
    `[관련 코드(SoT) 발췌]\n${input.codeContext}`,
    `[현재 문서 발췌]\n${input.docExcerpt}`,
    '위 코드 기준으로 문서 발췌가 사실과 어긋났는지 판정하고, 어긋났으면 수정안을 제안하세요.',
    feedback,
  ].join('\n\n');
}

export const EVALUATOR_SYSTEM_PROMPT =
  '당신은 문서 수정 제안을 코드 사실과 대조해 채점하는 엄격한 평가자입니다. ' +
  '제안이 코드와 정확히 일치하고 과/부족 수정이 없을 때만 pass=true. 의심되면 pass=false. ' +
  '반드시 아래 JSON 한 개만 출력합니다.\n' +
  '{"pass": boolean, "score": number(0-100), "feedback": string}';

export function buildEvaluatorPrompt(input: {
  filePath: string;
  codeContext: string;
  editsSummary: string;
}): string {
  return [
    `[대상 문서] ${input.filePath}`,
    `[관련 코드(SoT) 발췌]\n${input.codeContext}`,
    `[제안된 편집]\n${input.editsSummary}`,
    '이 편집이 코드 사실과 정확히 일치하는지 채점하세요. 과수정/부족수정도 감점하세요.',
  ].join('\n\n');
}
