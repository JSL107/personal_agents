import { parseBlogEdit } from './blog-edit.parser';

const publishable = {
  publishable: true,
  reason: '캐시 재검증 흐름이라는 요지가 분명하다.',
  title: '브라우저는 왜 다시 받아오지 않을까',
  slug: 'http-cache-revalidation',
  description: 'ETag 와 304 로 캐시를 재검증하는 흐름을 정리했다.',
  body: '## 문제\n\n매번 다시 받아왔다.',
};

describe('parseBlogEdit', () => {
  it('발행 가능 판정을 그대로 파싱한다', () => {
    expect(parseBlogEdit(JSON.stringify(publishable))).toEqual(publishable);
  });

  it('본문에 코드펜스가 있어도 파싱한다 (run#864 회귀 방지)', () => {
    const withFence = {
      ...publishable,
      body: '## 문제\n\n```php\n$row = query("SELECT 1");\n```\n\n## 교훈\n원장을 먼저.',
    };

    const parsed = parseBlogEdit(JSON.stringify(withFence));

    expect(parsed.publishable).toBe(true);
    expect(parsed).toMatchObject({ body: withFence.body });
  });

  it('발행 부적합이면 이유만 남긴다', () => {
    const parsed = parseBlogEdit(
      JSON.stringify({
        publishable: false,
        reason: '강의 필기를 옮겨 적은 수준이라 글쓴이의 판단이 없다.',
        title: '',
        slug: '',
        description: '',
        body: '',
      }),
    );

    expect(parsed).toEqual({
      publishable: false,
      reason: '강의 필기를 옮겨 적은 수준이라 글쓴이의 판단이 없다.',
    });
  });

  it('이유 없는 판정은 계약 위반으로 끊는다', () => {
    expect(() =>
      parseBlogEdit(JSON.stringify({ publishable: false, reason: '  ' })),
    ).toThrow(/편집 결과를 해석하지 못했습니다/);
  });

  it('publishable 이 boolean 이 아니면 거절한다', () => {
    expect(() =>
      parseBlogEdit(JSON.stringify({ ...publishable, publishable: 'yes' })),
    ).toThrow(/편집 결과를 해석하지 못했습니다/);
  });

  for (const field of ['title', 'slug', 'description', 'body']) {
    it(`발행 가능인데 ${field} 가 비면 거절한다`, () => {
      expect(() =>
        parseBlogEdit(JSON.stringify({ ...publishable, [field]: '   ' })),
      ).toThrow(/편집 결과를 해석하지 못했습니다/);
    });
  }

  // slug 은 URL 이 되고 한 번 발행하면 바꿀 때 링크가 깨진다 — 형식을 여기서 막는다.
  for (const slug of [
    '한글슬러그',
    'Upper-Case',
    'trailing-',
    'double--hyphen',
    'with space',
    'slash/inside',
  ]) {
    it(`slug "${slug}" 은 거절한다`, () => {
      expect(() =>
        parseBlogEdit(JSON.stringify({ ...publishable, slug })),
      ).toThrow(/slug 형식이 맞지 않습니다|편집 결과를 해석하지 못했습니다/);
    });
  }

  it('실패 cause 에 모델 raw 응답 앞부분을 남긴다', () => {
    try {
      parseBlogEdit('죄송합니다. JSON 을 만들 수 없습니다.');
      throw new Error('여기 도달하면 안 된다');
    } catch (error: unknown) {
      expect((error as { cause?: Error }).cause?.message).toContain(
        'raw=죄송합니다.',
      );
    }
  });
});
