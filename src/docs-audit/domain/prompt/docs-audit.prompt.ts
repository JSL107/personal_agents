import { OutputJsonSchema } from '../../../model-router/domain/model-router.type';
import { RUBRIC } from '../docs-audit-rubric';

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

const RUBRIC_LINES = RUBRIC.map(
  (spec) =>
    `- ${spec.key} (${spec.label}${spec.required ? ', 필수' : ''}): ${spec.question}`,
).join('\n');

// 점수를 직접 매기지 않게 한다 — 항목마다 예/아니오와 근거만 받고, 점수·통과는 코드가 계산한다
// (scoreRubric). 0~100 을 고르게 하면 같은 제안도 회차마다 숫자가 달라 확정·중단 판정이 흔들렸다.
export const EVALUATOR_SYSTEM_PROMPT =
  '당신은 문서 수정 제안을 코드 사실과 대조하는 엄격한 평가자입니다. ' +
  '아래 항목마다 passed(예=true/아니오=false)와 evidence(판단 근거 한 줄)를 답합니다. ' +
  '점수는 매기지 않습니다. 확신이 없으면 false 로 답하고, false 면 evidence 에 무엇이 틀렸는지 구체적으로 적습니다. ' +
  'evidence 에는 근거가 된 코드나 문서 문장을 짧게 인용합니다.\n\n' +
  `[채점 항목]\n${RUBRIC_LINES}\n\n` +
  '반드시 아래 JSON 한 개만 출력합니다. items 에는 위 항목 5개를 모두 넣습니다.\n' +
  '{"items": [{"key": string, "passed": boolean, "evidence": string}]}';

export const EVALUATOR_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      // 개수 제약(minItems)은 걸지 않는다 — 항목 누락은 scoreRubric 이 "판정 불가" 로 잡는다.
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: RUBRIC.map((spec) => spec.key) },
          passed: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['key', 'passed', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export function buildEvaluatorPrompt(input: {
  filePath: string;
  codeContext: string;
  docExcerpt: string;
  editsSummary: string;
}): string {
  // complete(빠짐없음)를 판정하려면 고치기 전 문서를 봐야 한다 — 없으면 덜 고친 곳을 알 수 없다.
  return [
    `[대상 문서] ${input.filePath}`,
    `[관련 코드(SoT) 발췌]\n${input.codeContext}`,
    `[현재 문서 발췌]\n${input.docExcerpt}`,
    `[제안된 편집]\n${input.editsSummary}`,
    '채점 항목마다 예/아니오와 근거를 답하세요.',
  ].join('\n\n');
}
