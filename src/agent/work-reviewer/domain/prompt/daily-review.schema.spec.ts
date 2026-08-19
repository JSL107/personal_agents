import { DAILY_REVIEW_OUTPUT_SCHEMA } from './daily-review.schema';
import { isDailyReviewShape } from './daily-review.shape';

// 스키마에 선언된 property 만으로 최소 객체를 지어 shape 가드에 통과시킨다.
// 스키마와 파서가 서로 다른 계약을 보게 되면(필드 이름 변경·누락) 여기서 깨진다.
const buildMinimalObject = (
  schema: Record<string, unknown>,
): Record<string, unknown> => {
  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const built: Record<string, unknown> = {};
  for (const [key, definition] of Object.entries(properties)) {
    built[key] = buildValue(definition);
  }
  return built;
};

const buildValue = (definition: Record<string, unknown>): unknown => {
  const type = definition.type;
  // nullable 은 null 도 유효하지만, 여기서는 "채워진 쪽" 을 만들어 하위 필드까지 검증한다.
  const resolved = Array.isArray(type)
    ? (type as string[]).find((candidate) => candidate !== 'null')
    : type;
  if (resolved === 'object') {
    return buildMinimalObject(definition);
  }
  if (resolved === 'array') {
    return ['x'];
  }
  if (resolved === 'number') {
    return 0;
  }
  return 'x';
};

describe('DAILY_REVIEW_OUTPUT_SCHEMA', () => {
  it('스키마대로 만든 객체는 파서의 shape 가드를 통과한다 (스키마↔파서 계약 일치)', () => {
    expect(
      isDailyReviewShape(buildMinimalObject(DAILY_REVIEW_OUTPUT_SCHEMA)),
    ).toBe(true);
  });

  it('선언한 property 를 전부 required 로 요구한다 (strict schema 는 선택 필드를 허용하지 않음)', () => {
    const properties = Object.keys(
      DAILY_REVIEW_OUTPUT_SCHEMA.properties as Record<string, unknown>,
    );
    expect(DAILY_REVIEW_OUTPUT_SCHEMA.required).toEqual(properties);
    expect(DAILY_REVIEW_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it('improvementBeforeAfter 는 null 을 허용한다 (도메인상 nullable)', () => {
    const properties = DAILY_REVIEW_OUTPUT_SCHEMA.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.improvementBeforeAfter.type).toContain('null');
  });
});
