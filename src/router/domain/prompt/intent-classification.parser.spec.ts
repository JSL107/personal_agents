import { AgentType } from '../../../model-router/domain/model-router.type';
import { RouterErrorCode } from '../router-error-code.enum';
import { parseIntentClassification } from './intent-classification.parser';

describe('parseIntentClassification', () => {
  it('정상 JSON 을 IntentClassification 으로 파싱', () => {
    const raw = JSON.stringify({
      agentType: 'PM',
      confidence: 0.9,
      reason: '일정 키워드',
    });

    const result = parseIntentClassification(raw);

    expect(result.agentType).toBe(AgentType.PM);
    expect(result.confidence).toBe(0.9);
    expect(result.reason).toBe('일정 키워드');
  });

  it('```json 코드 fence 로 감싸진 응답도 graceful 처리', () => {
    const raw =
      '```json\n' +
      JSON.stringify({
        agentType: 'BE_TEST',
        confidence: 0.7,
        reason: 'spec 키워드',
      }) +
      '\n```';

    const result = parseIntentClassification(raw);

    expect(result.agentType).toBe(AgentType.BE_TEST);
    expect(result.confidence).toBe(0.7);
  });

  it('UNKNOWN 도 valid agentType 으로 통과', () => {
    const raw = JSON.stringify({
      agentType: 'UNKNOWN',
      confidence: 0,
      reason: '의도 모호',
    });

    const result = parseIntentClassification(raw);

    expect(result.agentType).toBe('UNKNOWN');
  });

  it('confidence 가 1 초과면 1 로 clamp, 음수면 0 으로 clamp', () => {
    const overflow = parseIntentClassification(
      JSON.stringify({ agentType: 'PM', confidence: 1.7, reason: '' }),
    );
    expect(overflow.confidence).toBe(1);

    const underflow = parseIntentClassification(
      JSON.stringify({ agentType: 'PM', confidence: -0.5, reason: '' }),
    );
    expect(underflow.confidence).toBe(0);
  });

  it('confidence 가 number 가 아니면 0 fallback', () => {
    const raw = JSON.stringify({
      agentType: 'PM',
      confidence: '0.5',
      reason: '',
    });

    const result = parseIntentClassification(raw);

    expect(result.confidence).toBe(0);
  });

  it('agentType 이 enum 외 값이면 RouterException(INTENT_CLASSIFY_FAILED)', () => {
    const raw = JSON.stringify({
      agentType: 'INVALID_AGENT',
      confidence: 0.9,
      reason: '',
    });

    expect(() => parseIntentClassification(raw)).toThrow(
      expect.objectContaining({
        routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      }),
    );
  });

  it('JSON parse 실패 시 RouterException(INTENT_CLASSIFY_FAILED)', () => {
    expect(() => parseIntentClassification('not json')).toThrow(
      expect.objectContaining({
        routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      }),
    );
  });

  it('userInstruction 이 비어있지 않은 string 이면 추출', () => {
    const raw = JSON.stringify({
      agentType: 'PM',
      confidence: 0.9,
      reason: '직전 대화 follow-up',
      userInstruction: '직전 논의한 개선 항목을 우선순위화',
    });

    const result = parseIntentClassification(raw);

    expect(result.userInstruction).toBe('직전 논의한 개선 항목을 우선순위화');
  });

  it('userInstruction 누락 / 빈 문자열 / 공백뿐이면 undefined', () => {
    const missing = parseIntentClassification(
      JSON.stringify({ agentType: 'PM', confidence: 0.9, reason: '' }),
    );
    expect(missing.userInstruction).toBeUndefined();

    const blank = parseIntentClassification(
      JSON.stringify({
        agentType: 'PM',
        confidence: 0.9,
        reason: '',
        userInstruction: '   ',
      }),
    );
    expect(blank.userInstruction).toBeUndefined();

    const nonString = parseIntentClassification(
      JSON.stringify({
        agentType: 'PM',
        confidence: 0.9,
        reason: '',
        userInstruction: 123,
      }),
    );
    expect(nonString.userInstruction).toBeUndefined();
  });

  it('객체 아닌 JSON (array / null) 도 INTENT_CLASSIFY_FAILED', () => {
    expect(() => parseIntentClassification('[]')).toThrow(
      expect.objectContaining({
        routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      }),
    );
    expect(() => parseIntentClassification('null')).toThrow(
      expect.objectContaining({
        routerErrorCode: RouterErrorCode.INTENT_CLASSIFY_FAILED,
      }),
    );
  });
});
