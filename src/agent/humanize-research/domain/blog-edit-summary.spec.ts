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
