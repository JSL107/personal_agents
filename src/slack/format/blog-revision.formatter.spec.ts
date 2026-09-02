import { BlogRevisionReport } from '../../agent/blog/application/measure-blog-revision.usecase';
import { summarizeRevisions } from '../../agent/blog/domain/revision-rate';
import { formatBlogRevision } from './blog-revision.formatter';

const NOW = new Date('2026-09-02T00:00:00Z');

const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

const row = (days: number, percent: number, slug = 'post') => ({
  path: `src/content/posts/${slug}.md`,
  publishedAt: daysAgo(days),
  count: { addedLines: 0, removedLines: 0, totalLines: 100, percent },
});

const report = (
  rows: ReturnType<typeof row>[],
  unmatchedCount = 0,
): BlogRevisionReport => ({
  rows,
  summary: summarizeRevisions(rows.map((item) => item.count)),
  unmatchedCount,
});

describe('formatBlogRevision', () => {
  it('구간에 발행이 없으면 카드를 만들지 않는다', () => {
    // 빈 카드를 보내면 조용한 계기판이 매주 잡음을 낸다.
    expect(formatBlogRevision(report([row(30, 50)]), NOW)).toBeNull();
  });

  it('수정률과 함께 그 값이 무엇인지, 어느 쪽이 좋은지 적는다', () => {
    // 숫자만 던지면 42% 가 좋은 값인지 나쁜 값인지 읽는 사람이 알 수 없다.
    const text = formatBlogRevision(report([row(1, 40), row(3, 44)]), NOW);

    expect(text).toContain('42%');
    expect(text).toContain('사람이 다시 쓴 비율');
    expect(text).toContain('낮을수록');
  });

  it('두 구간이 표본을 채우면 직전 대비 변화를 적는다', () => {
    const text = formatBlogRevision(
      report([
        row(1, 30),
        row(3, 30),
        row(5, 30),
        row(16, 60),
        row(18, 60),
        row(20, 60),
      ]),
      NOW,
    );

    expect(text).toContain('직전 60%에서 30%p 줄었습니다');
  });

  it('표본이 모자라면 비교하지 않고 그 사실을 밝힌다', () => {
    // 한 편으로 낸 비율이 판단 근거로 쓰이면 그 글 하나가 눈금을 흔든다.
    const text = formatBlogRevision(report([row(1, 40), row(20, 90)]), NOW);

    expect(text).toContain('표본이 모자랍니다');
    expect(text).not.toContain('%p');
  });

  it('많이 고친 글을 이름으로 짚는다', () => {
    const text = formatBlogRevision(
      report([row(1, 20, 'gentle'), row(2, 90, 'rough')]),
      NOW,
    );

    expect(text).toContain('90% — rough');
  });

  it('짝을 못 찾은 글이 있으면 편수를 함께 밝힌다', () => {
    // 빠진 글이 늘면 평균이 실제보다 좋아 보인다.
    const text = formatBlogRevision(report([row(1, 40)], 2), NOW);

    expect(text).toContain('짝을 못 찾은 글 2편');
  });

  it('짝이 모두 맞으면 그 줄을 넣지 않는다', () => {
    const text = formatBlogRevision(report([row(1, 40)]), NOW);

    expect(text).not.toContain('짝을 못 찾은');
  });
});
