import {
  BLOG_STATUS_PUBLISHED,
  buildBlogPublishProperties,
} from './blog-publish-properties';

describe('buildBlogPublishProperties', () => {
  it('상태=발행 + 발행일은 항상 포함', () => {
    const props = buildBlogPublishProperties({
      tags: [],
      summary: null,
      publishedAt: '2026-06-17',
    });
    expect(props['상태']).toEqual({ select: { name: BLOG_STATUS_PUBLISHED } });
    expect(props['발행일']).toEqual({ date: { start: '2026-06-17' } });
  });

  it('태그/요약 비면 생략', () => {
    const props = buildBlogPublishProperties({
      tags: [],
      summary: null,
      publishedAt: '2026-06-17',
    });
    expect(props['태그']).toBeUndefined();
    expect(props['요약']).toBeUndefined();
  });

  it('태그/요약 있으면 multi_select/rich_text 로 구성', () => {
    const props = buildBlogPublishProperties({
      tags: ['NestJS', 'Notion'],
      summary: '요약.',
      publishedAt: '2026-06-17',
    });
    expect(props['태그']).toEqual({
      multi_select: [{ name: 'NestJS' }, { name: 'Notion' }],
    });
    expect(props['요약']).toEqual({
      rich_text: [{ text: { content: '요약.' } }],
    });
  });
});
