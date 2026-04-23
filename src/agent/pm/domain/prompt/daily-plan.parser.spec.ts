import { PmAgentException } from '../pm-agent.exception';
import { parseDailyPlan } from './daily-plan.parser';

describe('parseDailyPlan', () => {
  const validPlan = {
    topPriority: 'PM Agent /today 구현',
    morning: ['prisma schema 확인', '프롬프트 다듬기'],
    afternoon: ['코드 리뷰 2건', '일일 회고'],
    blocker: null,
    estimatedHours: 6.5,
    reasoning: '가장 impact 큰 PM Agent 를 오전 집중 시간에 배치',
  };

  it('순수 JSON 문자열을 DailyPlan 으로 파싱한다', () => {
    const result = parseDailyPlan(JSON.stringify(validPlan));
    expect(result).toEqual(validPlan);
  });

  it('```json 코드 펜스 감싼 응답도 벗겨낸 뒤 파싱한다', () => {
    const wrapped = ['```json', JSON.stringify(validPlan), '```'].join('\n');
    const result = parseDailyPlan(wrapped);
    expect(result).toEqual(validPlan);
  });

  it('JSON 으로 파싱 불가하면 INVALID_MODEL_OUTPUT 예외', () => {
    expect(() => parseDailyPlan('this is not json')).toThrow(PmAgentException);
  });

  it('필수 필드 누락 시 INVALID_MODEL_OUTPUT 예외', () => {
    const broken = { ...validPlan } as Partial<typeof validPlan>;
    delete broken.topPriority;
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('blocker 가 string 또는 null 이 아닐 때 예외', () => {
    const broken = { ...validPlan, blocker: 123 };
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });

  it('morning 이 문자열 배열이 아닐 때 예외', () => {
    const broken = { ...validPlan, morning: [1, 2] };
    expect(() => parseDailyPlan(JSON.stringify(broken))).toThrow(
      PmAgentException,
    );
  });
});
