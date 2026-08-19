import {
  AgentType,
  OutputJsonSchema,
} from '../../../model-router/domain/model-router.type';

// 분류 결과의 형태를 모델 샘플링 단계에서 고정한다 (codex `--output-schema`).
//
// 이 워커를 1순위로 고른 이유: 분류 실패는 예외로 드러나지 않고 조용히 흡수된다.
// parseIntentClassification 은 confidence 가 숫자가 아니면 0, reason 이 문자열이 아니면 ''
// 으로 채우고 정상 반환하므로, 원장에는 SUCCEEDED 로 남고 라우팅 품질만 나빠진다.
// 형태를 강제하면 그 조용한 경로 자체가 사라진다.
//
// agentType 목록은 AgentType enum 에서 파생시킨다 — 손으로 복사하면 새 에이전트를 추가할 때
// 이 파일만 빠져도 아무도 모른 채 그 에이전트가 분류 후보에서 영구히 제외된다.
const AGENT_TYPE_VALUES: string[] = [...Object.values(AgentType), 'UNKNOWN'];

// userInstruction 은 도메인상 선택 필드지만 required 에 포함하고 null 을 허용한다 —
// strict schema 는 선언한 property 를 전부 required 로 요구하므로, "없음" 을 키 누락이 아니라
// null 로 표현해야 한다. parseIntentClassification 은 non-string 을 undefined 로 떨어뜨리므로
// null 이 그대로 기존 optional 의미로 흡수된다.
export const INTENT_CLASSIFICATION_OUTPUT_SCHEMA: OutputJsonSchema = {
  type: 'object',
  properties: {
    agentType: { type: 'string', enum: AGENT_TYPE_VALUES },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    userInstruction: { type: ['string', 'null'] },
  },
  required: ['agentType', 'confidence', 'reason', 'userInstruction'],
  additionalProperties: false,
};
