import {
  buildMinimalObject,
  findStrictSchemaViolations,
} from '../../../../common/util/json-schema-probe.util';
import { DAILY_REVIEW_OUTPUT_SCHEMA } from './daily-review.schema';
import { isDailyReviewShape } from './daily-review.shape';
import { WORK_REVIEWER_SYSTEM_PROMPT } from './work-reviewer-system.prompt';

describe('DAILY_REVIEW_OUTPUT_SCHEMA', () => {
  it('스키마대로 만든 객체는 파서의 shape 가드를 통과한다 (스키마↔파서 계약 일치)', () => {
    expect(
      isDailyReviewShape(buildMinimalObject(DAILY_REVIEW_OUTPUT_SCHEMA)),
    ).toBe(true);
  });

  it('모든 객체가 strict — 중첩까지 required + additionalProperties:false', () => {
    // 중첩 객체(impact / improvementBeforeAfter)에서 규칙을 빠뜨리면 codex 가 모델 호출 전에
    // exit 1 로 끊어 이 워커가 통째로 실패한다. 최상위만 보면 그때까지 초록이다.
    expect(findStrictSchemaViolations(DAILY_REVIEW_OUTPUT_SCHEMA)).toEqual([]);
  });

  it('시스템 프롬프트의 예시 JSON 이 스키마의 모든 필드를 담고 있다', () => {
    // additionalProperties:false 는 스키마에 없는 필드를 모델이 낼 수 **없게** 만든다.
    // 그래서 타입에 필드를 추가하고 스키마를 안 고치면, 예전처럼 "가끔 누락" 이 아니라
    // 항상 누락된다. 두 소스가 함께 움직이는지 못 박는다.
    for (const key of Object.keys(
      DAILY_REVIEW_OUTPUT_SCHEMA.properties as Record<string, unknown>,
    )) {
      expect(WORK_REVIEWER_SYSTEM_PROMPT).toContain(`"${key}"`);
    }
  });

  it('improvementBeforeAfter 는 null 을 허용한다 (도메인상 nullable)', () => {
    const properties = DAILY_REVIEW_OUTPUT_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.improvementBeforeAfter.type).toContain('null');
  });
});
