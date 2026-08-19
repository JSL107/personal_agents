import {
  buildMinimalObject,
  findStrictSchemaViolations,
} from '../../../common/util/json-schema-probe.util';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { parseIntentClassification } from './intent-classification.parser';
import { buildIntentClassificationOutputSchema } from './intent-classification.schema';
import { INTENT_CLASSIFIER_SYSTEM_PROMPT } from './intent-classifier-system.prompt';

// 실제 등록 dispatcher 를 흉내낸 최소 목록 — 라우팅 가능한 것만 들어온다는 전제를 재현한다.
const ROUTABLE = [
  AgentType.PM,
  AgentType.WORK_REVIEWER,
  AgentType.CODE_REVIEWER,
];

const getProperties = (
  schema: Record<string, unknown>,
): Record<string, Record<string, unknown>> =>
  schema.properties as Record<string, Record<string, unknown>>;

describe('buildIntentClassificationOutputSchema', () => {
  it('라우팅 가능한 agentType 과 UNKNOWN 만 허용한다', () => {
    const schema = buildIntentClassificationOutputSchema(ROUTABLE);
    const allowed = getProperties(schema).agentType.enum as string[];

    expect(allowed).toEqual([...ROUTABLE, 'UNKNOWN']);
  });

  it('dispatcher 가 없는 내부 타입은 후보에서 빠진다', () => {
    // 이 값들을 열어두면 모델이 고를 수 있고, IdaeriRouterUsecase 가
    // UNSUPPORTED_AGENT_TYPE 으로 끊어 개발자용 메시지가 사용자에게 그대로 노출된다.
    // 그 코드는 ConversationalReply 폴백 대상(INTENT_CLASSIFY_FAILED)이 아니다.
    const schema = buildIntentClassificationOutputSchema(ROUTABLE);
    const allowed = getProperties(schema).agentType.enum as string[];

    expect(allowed).not.toContain(AgentType.PAPER_RECOMMEND);
    expect(allowed).not.toContain(AgentType.EVENING_RETRO);
    expect(allowed).not.toContain(AgentType.HUMANIZER);
  });

  it('허용하는 agentType 은 전부 시스템 프롬프트가 설명한 후보다', () => {
    // 스키마 enum 은 모델에게 "허용된 메뉴" 자체로 보인다. 프롬프트가 설명하지 않은 값이
    // 메뉴에 있으면, 프롬프트가 UNKNOWN 으로 흘리려고 막아둔 입력에 새 출구가 생긴다.
    const promptCandidates = (
      INTENT_CLASSIFIER_SYSTEM_PROMPT.match(/^- [A-Z_]+:/gm) ?? []
    ).map((line) => line.slice(2, -1));
    // 정규식이 후보를 하나도 못 잡으면 아래 루프가 공허하게 통과한다 — 먼저 못 박는다.
    expect(promptCandidates.length).toBeGreaterThan(10);

    const schema = buildIntentClassificationOutputSchema(promptCandidates);
    const allowed = getProperties(schema).agentType.enum as string[];
    for (const candidate of allowed) {
      if (candidate === 'UNKNOWN') {
        continue;
      }
      expect(promptCandidates).toContain(candidate);
    }
  });

  it('중복 agentType 이 들어와도 enum 원소는 유일하다', () => {
    // JSON Schema 는 enum 원소의 유일성을 요구한다 — 중복이면 codex 가 파싱 단계에서 끊어
    // 그 호출이 전부 실패한다.
    const schema = buildIntentClassificationOutputSchema([
      AgentType.PM,
      AgentType.PM,
      'UNKNOWN',
    ]);
    const allowed = getProperties(schema).agentType.enum as string[];

    expect(allowed).toEqual([AgentType.PM, 'UNKNOWN']);
  });

  it('모든 객체가 strict — 중첩까지 required + additionalProperties:false', () => {
    expect(
      findStrictSchemaViolations(
        buildIntentClassificationOutputSchema(ROUTABLE),
      ),
    ).toEqual([]);
  });

  it('스키마대로 만든 객체는 파서를 통과하며 기본값으로 떨어지지 않는다', () => {
    // 필드 이름이 스키마와 파서 사이에서 갈리면 파서가 confidence=0 / reason='' 로 조용히
    // 흡수한다 — 이 스키마가 없애려던 바로 그 경로다. 값으로 확인한다.
    const schema = buildIntentClassificationOutputSchema(ROUTABLE);
    const probe = buildMinimalObject(schema);
    probe.agentType = AgentType.PM;

    const parsed = parseIntentClassification(JSON.stringify(probe));

    expect(parsed.agentType).toBe(AgentType.PM);
    expect(parsed.reason).not.toBe('');
    expect(parsed.confidence).toBeGreaterThan(0);
  });

  it('userInstruction 의 null 은 기존 optional 의미로 흡수된다', () => {
    // strict schema 라 "없음" 을 키 누락으로 표현할 수 없어 null 로 보낸다.
    const schema = buildIntentClassificationOutputSchema(ROUTABLE);
    expect(getProperties(schema).userInstruction.type).toContain('null');

    const parsed = parseIntentClassification(
      JSON.stringify({
        agentType: AgentType.PM,
        confidence: 0.9,
        reason: '오늘 계획 요청',
        userInstruction: null,
      }),
    );

    expect(parsed.userInstruction).toBeUndefined();
  });
});
