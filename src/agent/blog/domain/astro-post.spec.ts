import { buildAstroPost } from './astro-post';

describe('buildAstroPost', () => {
  const input = {
    title: '공유 DB 정합성',
    description: '공유 DB 전환에서 배운 점.',
    slug: 'shared-db-consistency',
    tags: ['backend', 'database'],
    createdTime: '2026-08-14T16:30:00.000Z',
    pageId: '37c69cbba394806a983fc42d03a12f19',
    body: '# 공유 DB 정합성\n\n본문입니다.',
  };

  it('KST 날짜와 ISO+09:00 발행 시각으로 Astro 파일을 만든다', () => {
    const post = buildAstroPost(input);

    expect(post.path).toBe(
      'src/content/posts/2026-08-15-shared-db-consistency.md',
    );
    expect(post.content).toContain('pubDatetime: 2026-08-15T01:30:00+09:00');
    expect(post.content).toContain('tags:\n  - "backend"\n  - "database"');
  });

  // frontmatter 가 깨지면 공개 저장소 main 에 커밋된 뒤 Astro 빌드 단계에서야 드러난다.
  it('개행·콜론이 든 title과 tag를 넣어도 frontmatter 구조가 유지된다', () => {
    const post = buildAstroPost({
      ...input,
      title: '정합성\n점검: 1차',
      tags: ['back: end', '줄\n바꿈'],
    });

    expect(post.content).toContain('title: "정합성\\n점검: 1차"');
    expect(post.content).toContain('tags:\n  - "back: end"\n  - "줄\\n바꿈"');
    // 여는 '---' + title/description/pubDatetime + 'tags:' + 태그 2줄 = 7줄에서 닫힌다.
    expect(post.content.split('\n---')[0].split('\n')).toHaveLength(7);
  });

  it('title과 description의 큰따옴표를 frontmatter에 안전하게 넣는다', () => {
    const post = buildAstroPost({
      ...input,
      title: '"정합성" 점검',
      description: '"Source of Truth"를 정한다.',
    });

    expect(post.content).toContain('title: "\\"정합성\\" 점검"');
    expect(post.content).toContain(
      'description: "\\"Source of Truth\\"를 정한다."',
    );
  });

  it('필수 description이 비어 있으면 발행 파일을 만들지 않는다', () => {
    expect(() => buildAstroPost({ ...input, description: '  ' })).toThrow(
      'description',
    );
  });

  it('pageId가 비어 있으면 fallback 경로를 조용히 만들지 않는다', () => {
    expect(() => buildAstroPost({ ...input, pageId: '  ' })).toThrow('pageId');
  });

  it('본문 맨 위의 H1 제목을 제거한다', () => {
    const post = buildAstroPost(input);

    expect(post.content).not.toContain('# 공유 DB 정합성');
    expect(post.content).toContain('\n\n본문입니다.\n');
  });

  it('slug을 소문자 kebab-case로 정규화하고 비면 pageId fallback을 쓴다', () => {
    const normalizedPost = buildAstroPost({
      ...input,
      slug: 'Shared DB / V2!',
      body: '본문',
    });
    const fallbackPost = buildAstroPost({
      ...input,
      slug: '---',
      pageId: '37c69cbba394806a983fc42d03a12f19',
      body: '본문',
    });

    expect(normalizedPost.path).toBe(
      'src/content/posts/2026-08-15-shared-db-v2.md',
    );
    expect(fallbackPost.path).toBe(
      'src/content/posts/2026-08-15-notion-37c69cbb.md',
    );
  });
});
