import { findStrictSchemaViolations } from '../../../common/util/json-schema-probe.util';
import { MENTION_REQUEST_OUTPUT_SCHEMA } from './mention-request.schema';

describe('MENTION_REQUEST_OUTPUT_SCHEMA', () => {
  it('모든 속성이 required이고 strict 출력 스키마 규칙을 지킨다', () => {
    expect(
      findStrictSchemaViolations(
        MENTION_REQUEST_OUTPUT_SCHEMA as Record<string, unknown>,
      ),
    ).toEqual([]);
  });
});
