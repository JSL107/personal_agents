import {
  buildMinimalObject,
  findStrictSchemaViolations,
} from '../../../../common/util/json-schema-probe.util';
import { parseBlogEdit } from './blog-edit.parser';
import {
  BLOG_ANONYMIZE_OUTPUT_SCHEMA,
  BLOG_EDIT_OUTPUT_SCHEMA,
} from './blog-publish.schema';

describe('BLOG_ANONYMIZE_OUTPUT_SCHEMA', () => {
  it('모든 객체가 strict — required + additionalProperties:false', () => {
    // 규칙을 빠뜨리면 codex 가 모델 호출 전에 exit 1 로 끊어 이 워커가 통째로 실패한다.
    expect(findStrictSchemaViolations(BLOG_ANONYMIZE_OUTPUT_SCHEMA)).toEqual(
      [],
    );
  });

  it('스키마대로 만든 객체는 익명화 파서가 요구하는 세 필드를 갖는다', () => {
    expect(
      Object.keys(buildMinimalObject(BLOG_ANONYMIZE_OUTPUT_SCHEMA)),
    ).toEqual(['slug', 'description', 'body']);
  });
});

describe('BLOG_EDIT_OUTPUT_SCHEMA', () => {
  it('모든 객체가 strict — required + additionalProperties:false', () => {
    expect(findStrictSchemaViolations(BLOG_EDIT_OUTPUT_SCHEMA)).toEqual([]);
  });

  // 스키마와 파서가 어긋나면 형태는 강제되는데 파서가 거절하는 최악의 조합이 된다.
  it('스키마대로 만든 객체를 편집 파서가 그대로 해석한다 (스키마↔파서 계약 일치)', () => {
    const minimal = buildMinimalObject(BLOG_EDIT_OUTPUT_SCHEMA) as Record<
      string,
      unknown
    >;

    expect(parseBlogEdit(JSON.stringify(minimal))).toMatchObject({
      publishable: true,
    });
  });

  it('발행 부적합 조합(빈 본문 필드 + 이유)도 파서가 받는다', () => {
    const minimal = buildMinimalObject(BLOG_EDIT_OUTPUT_SCHEMA) as Record<
      string,
      unknown
    >;

    expect(
      parseBlogEdit(
        JSON.stringify({
          ...minimal,
          publishable: false,
          reason: '필기 수준이다.',
          title: '',
          slug: '',
          description: '',
          body: '',
        }),
      ),
    ).toEqual({ publishable: false, reason: '필기 수준이다.' });
  });
});
