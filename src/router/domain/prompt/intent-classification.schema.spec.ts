import { AgentType } from '../../../model-router/domain/model-router.type';
import { parseIntentClassification } from './intent-classification.parser';
import { INTENT_CLASSIFICATION_OUTPUT_SCHEMA } from './intent-classification.schema';

const getProperties = (): Record<string, Record<string, unknown>> =>
  INTENT_CLASSIFICATION_OUTPUT_SCHEMA.properties as Record<
    string,
    Record<string, unknown>
  >;

describe('INTENT_CLASSIFICATION_OUTPUT_SCHEMA', () => {
  it('모든 AgentType 을 분류 후보로 열어둔다 (새 에이전트가 조용히 제외되지 않게)', () => {
    const allowed = getProperties().agentType.enum as string[];
    for (const agentType of Object.values(AgentType)) {
      expect(allowed).toContain(agentType);
    }
    expect(allowed).toContain('UNKNOWN');
    // 길이까지 고정 — enum 을 손으로 덧붙여 AgentType 에 없는 값이 섞이면 깨진다.
    expect(allowed).toHaveLength(Object.values(AgentType).length + 1);
  });

  it('선언한 property 를 전부 required 로 요구한다 (strict schema 는 선택 필드를 허용하지 않음)', () => {
    const properties = Object.keys(getProperties());
    expect(INTENT_CLASSIFICATION_OUTPUT_SCHEMA.required).toEqual(properties);
    expect(INTENT_CLASSIFICATION_OUTPUT_SCHEMA.additionalProperties).toBe(
      false,
    );
  });

  it('userInstruction 의 null 은 파서에서 기존 optional 의미로 흡수된다', () => {
    // strict schema 라 "없음" 을 키 누락으로 표현할 수 없어 null 로 보낸다.
    // 파서가 이를 undefined 로 떨어뜨리지 않으면 워커 입력에 null 이 그대로 흘러간다.
    expect(getProperties().userInstruction.type).toContain('null');

    const parsed = parseIntentClassification(
      JSON.stringify({
        agentType: AgentType.PM,
        confidence: 0.9,
        reason: '오늘 계획 요청',
        userInstruction: null,
      }),
    );
    expect(parsed.userInstruction).toBeUndefined();
    expect(parsed.agentType).toBe(AgentType.PM);
  });
});
