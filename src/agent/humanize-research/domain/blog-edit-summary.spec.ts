import {
  BlogEditKind,
  hashBlogChanges,
  renderBlogEditSummary,
  summarizeBlogEdits,
} from './blog-edit-summary';

describe('blog edit summary', () => {
  it('쉼표만 다른 짝은 PUNCTUATION_ONLY 로 센다', () => {
    const summary = summarizeBlogEdits({
      removedLines: ['처리하고, 저장한다'],
      addedLines: ['처리하고 저장한다'],
    });

    expect(summary.counts).toEqual({
      [BlogEditKind.PUNCTUATION_ONLY]: 1,
      [BlogEditKind.LEXICAL]: 0,
      [BlogEditKind.REWRITE]: 0,
      [BlogEditKind.DELETED]: 0,
      [BlogEditKind.ADDED]: 0,
    });
  });

  it('예시는 종류별 최대 3쌍만 남긴다', () => {
    const removedLines = Array.from(
      { length: 5 },
      (_, index) => `문장 ${index}, 끝`,
    );
    const addedLines = Array.from(
      { length: 5 },
      (_, index) => `문장 ${index} 끝`,
    );

    const summary = summarizeBlogEdits({ removedLines, addedLines });

    expect(summary.counts.PUNCTUATION_ONLY).toBe(5);
    expect(summary.examples.PUNCTUATION_ONLY).toHaveLength(3);
  });

  it('낱말 하나만 바뀐 긴 문장은 LEXICAL 로 센다', () => {
    const summary = summarizeBlogEdits({
      removedLines: [
        '배포 전에 설정 파일을 다시 읽고 캐시를 비운 뒤 서버를 재시작했다',
      ],
      addedLines: [
        '배포 전에 설정 파일을 다시 읽고 캐시를 지운 뒤 서버를 재시작했다',
      ],
    });

    expect(summary.counts[BlogEditKind.LEXICAL]).toBe(1);
    expect(summary.counts[BlogEditKind.REWRITE]).toBe(0);
  });

  it('절반쯤 겹치게 고쳐 쓴 문장은 REWRITE 로 센다', () => {
    const summary = summarizeBlogEdits({
      // bigram Dice 0.60 — 짝(≥0.5)이지만 LEXICAL(≥0.8)은 아니다
      removedLines: ['설정 파일을 다시 읽고 캐시를 비운 뒤 서버를 재시작했다'],
      addedLines: ['설정 파일을 다시 읽은 다음 서버를 곧바로 재시작했다'],
    });

    expect(summary.counts[BlogEditKind.REWRITE]).toBe(1);
    expect(summary.counts[BlogEditKind.LEXICAL]).toBe(0);
  });

  it('짝이 없으면 DELETED 와 ADDED 로 센다', () => {
    const summary = summarizeBlogEdits({
      removedLines: ['가나다라마바사'],
      addedLines: ['완전히 다른 새 문장입니다'],
    });

    expect(summary.counts.DELETED).toBe(1);
    expect(summary.counts.ADDED).toBe(1);
  });

  it('빈 줄과 중복 줄에서도 크래시 없이 남은 줄을 센다', () => {
    const summary = summarizeBlogEdits({
      removedLines: ['', 'A, B', 'A, B'],
      addedLines: ['A B'],
    });

    expect(summary.counts.PUNCTUATION_ONLY).toBe(1);
    expect(summary.counts.DELETED).toBe(1);
  });

  it('긴 예시가 많아도 렌더 결과는 4,000자 이하이다', () => {
    const removedLines = Array.from(
      { length: 10 },
      (_, index) => `${'가'.repeat(1999)}${index}`,
    );
    const addedLines = Array.from(
      { length: 10 },
      (_, index) => `${'가'.repeat(1999)}${index},`,
    );
    const summary = summarizeBlogEdits({ removedLines, addedLines });

    expect(
      renderBlogEditSummary({ path: '_posts/long.md', summary }).length,
    ).toBeLessThanOrEqual(4000);
  });

  it('긴 줄의 뒤쪽을 고쳐도 예시에 실제 변경 지점이 남는다', () => {
    const prefix = '나'.repeat(420);
    const summary = summarizeBlogEdits({
      removedLines: [`${prefix} 확인하고, 마무리했다`],
      addedLines: [`${prefix} 확인하고 마무리했다`],
    });

    const rendered = renderBlogEditSummary({ path: '_posts/tail.md', summary });

    expect(rendered).toContain('확인하고, 마무리했다');
    expect(rendered).toContain('확인하고 마무리했다');
  });

  it('같은 변경은 같은 해시이고 다른 변경은 다른 해시이다', () => {
    const changes = { removedLines: ['전'], addedLines: ['후'] };

    expect(hashBlogChanges(changes)).toBe(hashBlogChanges({ ...changes }));
    expect(hashBlogChanges(changes)).not.toBe(
      hashBlogChanges({
        removedLines: ['전'],
        addedLines: ['다른 후'],
      }),
    );
    expect(hashBlogChanges(changes)).toMatch(/^[a-f0-9]{8}$/u);
  });
});
