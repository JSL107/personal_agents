import { findStrictSchemaViolations } from '../../../common/util/json-schema-probe.util';
import { MANAGEMENT_INTENT_OUTPUT_SCHEMA } from './management-intent.schema';

describe('MANAGEMENT_INTENT_OUTPUT_SCHEMA', () => {
  // codex `--output-schema` 는 strict 라 선언한 property 가 하나라도 required 에서 빠지면 모델 호출 전에
  // 끊긴다. 단위 테스트는 모델을 mock 해서 이 실패를 못 보므로 스키마 자체를 점검한다.
  it('strict 규칙을 지킨다', () => {
    expect(
      findStrictSchemaViolations(
        MANAGEMENT_INTENT_OUTPUT_SCHEMA as Record<string, unknown>,
      ),
    ).toEqual([]);
  });
});
