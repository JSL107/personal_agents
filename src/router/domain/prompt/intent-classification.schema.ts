import { OutputJsonSchema } from '../../../model-router/domain/model-router.type';

// 분류 결과의 형태를 모델 샘플링 단계에서 고정한다 (codex `--output-schema`).
//
// 이 워커를 1순위로 고른 이유: 분류 실패는 예외로 드러나지 않고 조용히 흡수된다.
// parseIntentClassification 은 confidence 가 숫자가 아니면 0, reason 이 문자열이 아니면 ''
// 으로 채우고 정상 반환하므로, 원장에는 SUCCEEDED 로 남고 라우팅 품질만 나빠진다.
// 형태를 강제하면 그 조용한 경로 자체가 사라진다.
//
// ⚠️ agentType 후보는 **등록된 dispatcher** 에서 받는다. AgentType enum 전체를 넣으면 안 된다 —
// enum 32개 중 라우팅 가능한 것은 19개뿐이고, 나머지(EVENING_RETRO·PAPER_RECOMMEND·HUMANIZER 등)는
// dispatcher 가 없어 IdaeriRouterUsecase 가 UNSUPPORTED_AGENT_TYPE 으로 끊는다. 그 코드는
// ConversationalReply 폴백 대상(INTENT_CLASSIFY_FAILED)이 아니라서, 사용자에게 "해당 agent module 이
// AGENT_DISPATCHER_PORT 에 등록됐는지 확인하세요" 같은 개발자용 메시지가 그대로 노출된다.
// 프롬프트 지시와 달리 스키마 enum 은 모델에게 "허용된 메뉴" 자체로 보이므로, 넓은 메뉴는
// 프롬프트가 UNKNOWN 으로 흘리려고 막아둔 입력에 새 출구를 열어준다.
export const buildIntentClassificationOutputSchema = (
  routableAgentTypes: string[],
): OutputJsonSchema => ({
  type: 'object',
  properties: {
    // UNKNOWN 은 라우팅 대상이 아니라 "해당 worker 없음" 신호 — 중복 없이 한 번만 넣는다
    // (JSON Schema 는 enum 원소의 유일성을 요구하고, 중복이면 codex 가 파싱 단계에서 끊는다).
    agentType: {
      type: 'string',
      enum: [...new Set([...routableAgentTypes, 'UNKNOWN'])],
    },
    confidence: { type: 'number' },
    reason: { type: 'string' },
    // 도메인상 선택 필드지만 required 에 포함하고 null 을 허용한다 — strict schema 는 선언한
    // property 를 전부 required 로 요구하므로, "없음" 을 키 누락이 아니라 null 로 표현해야 한다.
    // parseIntentClassification 은 non-string 을 undefined 로 떨어뜨리므로 null 이 그대로
    // 기존 optional 의미로 흡수된다.
    userInstruction: { type: ['string', 'null'] },
  },
  required: ['agentType', 'confidence', 'reason', 'userInstruction'],
  additionalProperties: false,
});
