import {
  buildBlogPublishProperties,
  DEFAULT_BLOG_STATUS_PUBLISHED,
} from './blog-publish-properties';

describe('buildBlogPublishProperties', () => {
  it('상태=발행 + 발행일은 항상 포함', () => {
    const properties = buildBlogPublishProperties({
      tags: [],
      summary: null,
      publishedAt: '2026-06-17',
    });
    expect(properties['상태']).toEqual({
      select: { name: DEFAULT_BLOG_STATUS_PUBLISHED },
    });
    expect(properties['발행일']).toEqual({ date: { start: '2026-06-17' } });
  });

  it('태그/요약 비면 생략', () => {
    const properties = buildBlogPublishProperties({
      tags: [],
      summary: null,
      publishedAt: '2026-06-17',
    });
    expect(properties['태그']).toBeUndefined();
    expect(properties['요약']).toBeUndefined();
  });

  it('태그/요약 있으면 multi_select/rich_text 로 구성', () => {
    const properties = buildBlogPublishProperties({
      tags: ['NestJS', 'Notion'],
      summary: '요약.',
      publishedAt: '2026-06-17',
    });
    expect(properties['태그']).toEqual({
      multi_select: [{ name: 'NestJS' }, { name: 'Notion' }],
    });
    expect(properties['요약']).toEqual({
      rich_text: [{ text: { content: '요약.' } }],
    });
  });

  it('커스텀 속성명과 발행 상태값으로 payload 를 구성', () => {
    const properties = buildBlogPublishProperties(
      {
        tags: ['NestJS'],
        summary: '요약.',
        publishedAt: '2026-06-17',
      },
      {
        status: 'Status',
        publishedAt: 'Published Date',
        tags: 'Topics',
        summary: 'Summary',
      },
      'Published',
    );

    expect(properties['Status']).toEqual({
      select: { name: 'Published' },
    });
    expect(properties['Published Date']).toEqual({
      date: { start: '2026-06-17' },
    });
    expect(properties['Topics']).toEqual({
      multi_select: [{ name: 'NestJS' }],
    });
    expect(properties['Summary']).toEqual({
      rich_text: [{ text: { content: '요약.' } }],
    });
  });
});
