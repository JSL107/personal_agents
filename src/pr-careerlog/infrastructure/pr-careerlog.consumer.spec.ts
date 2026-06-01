import { PullRequestDetail } from '../../github/domain/github.type';
import { NotionPlanBlock } from '../../notion/domain/port/notion-client.port';
import { buildPrCareerLogBlocks } from './pr-careerlog.consumer';

// NotionPlanBlock union 에서 divider 외 모든 block 은 `text` 필드 보유 — narrowing helper.
type TextBlock = Exclude<NotionPlanBlock, { type: 'divider' }>;
const isTextBlock = (block: NotionPlanBlock): block is TextBlock =>
  block.type !== 'divider';

describe('buildPrCareerLogBlocks — PR 메타 → Notion block 변환 (LLM X)', () => {
  const buildDetail = (
    overrides: Partial<PullRequestDetail> = {},
  ): PullRequestDetail => ({
    number: 99,
    title: 'feat: payment hooks',
    body: 'closes #42 — adds payment validation API.',
    repo: 'foo/bar',
    url: 'https://github.com/foo/bar/pull/99',
    baseRef: 'main',
    headRef: 'feat/payment',
    authorLogin: 'me',
    changedFiles: ['src/payment.ts', 'src/payment.spec.ts'],
    changedFilesTruncated: false,
    changedFilesTotalCount: 2,
    additions: 120,
    deletions: 8,
    ...overrides,
  });

  it('필수 block (heading / 정량 / 정성 / 링크 / divider) 모두 포함', () => {
    const blocks = buildPrCareerLogBlocks({
      detail: buildDetail(),
      prRef: 'foo/bar#99',
      todayKst: '2026-06-01',
    });

    expect(blocks[0]).toEqual({
      type: 'heading',
      text: '💼 foo/bar#99 — feat: payment hooks (2026-06-01)',
    });
    // 정량 subheading + additions/deletions bullet 포함.
    expect(
      blocks.some((b) => isTextBlock(b) && b.type === 'subheading' && b.text === '정량'),
    ).toBe(true);
    const quantBullet = blocks.find(
      (b): b is TextBlock =>
        isTextBlock(b) && b.type === 'bullet' && b.text.includes('+120'),
    );
    expect(quantBullet?.text).toContain('+120');
    expect(quantBullet?.text).toContain('−8');
    expect(quantBullet?.text).toContain('changed files: 2');

    // 정성 subheading + title bullet.
    expect(
      blocks.some((b) => isTextBlock(b) && b.type === 'subheading' && b.text === '정성'),
    ).toBe(true);
    expect(
      blocks.some(
        (b) =>
          isTextBlock(b) && b.type === 'bullet' && b.text === 'feat: payment hooks',
      ),
    ).toBe(true);

    // 본문 paragraph + 링크 paragraph + 마지막 divider.
    expect(
      blocks.some(
        (b) =>
          isTextBlock(b) &&
          b.type === 'paragraph' &&
          b.text.includes('payment validation'),
      ),
    ).toBe(true);
    expect(
      blocks.some(
        (b) =>
          isTextBlock(b) &&
          b.type === 'paragraph' &&
          b.text === '링크: https://github.com/foo/bar/pull/99',
      ),
    ).toBe(true);
    expect(blocks[blocks.length - 1]).toEqual({ type: 'divider' });
  });

  it('changedFiles 대표 5개만 노출 + truncated 표시', () => {
    const blocks = buildPrCareerLogBlocks({
      detail: buildDetail({
        changedFiles: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'],
        changedFilesTruncated: true,
        changedFilesTotalCount: 7,
      }),
      prRef: 'foo/bar#99',
      todayKst: '2026-06-01',
    });

    const filesBullet = blocks.find(
      (b): b is TextBlock =>
        isTextBlock(b) && b.type === 'bullet' && b.text.startsWith('대표 파일'),
    );
    expect(filesBullet).toBeDefined();
    expect(filesBullet?.text).toContain('a.ts, b.ts, c.ts, d.ts, e.ts');
    expect(filesBullet?.text).not.toContain('g.ts');
    expect(filesBullet?.text).toContain('…');
  });

  it('changedFiles 빈 배열이면 대표 파일 block 미생성', () => {
    const blocks = buildPrCareerLogBlocks({
      detail: buildDetail({ changedFiles: [] }),
      prRef: 'foo/bar#99',
      todayKst: '2026-06-01',
    });
    expect(
      blocks.some((b) => b.type !== 'divider' && b.text.startsWith('대표 파일')),
    ).toBe(false);
  });

  it('body 가 cap (600) 초과 시 잘리고 ellipsis 부착', () => {
    const longBody = 'a'.repeat(800);
    const blocks = buildPrCareerLogBlocks({
      detail: buildDetail({ body: longBody }),
      prRef: 'foo/bar#99',
      todayKst: '2026-06-01',
    });
    const bodyPara = blocks.find(
      (b): b is TextBlock =>
        isTextBlock(b) && b.type === 'paragraph' && b.text.startsWith('a'),
    );
    expect(bodyPara).toBeDefined();
    if (!bodyPara) {
      throw new Error('bodyPara not found');
    }
    expect(bodyPara.text.endsWith('…')).toBe(true);
    expect(bodyPara.text.length).toBeLessThanOrEqual(601);
  });

  it('body 가 비어있으면 본문 paragraph 미생성', () => {
    const blocks = buildPrCareerLogBlocks({
      detail: buildDetail({ body: '   ' }),
      prRef: 'foo/bar#99',
      todayKst: '2026-06-01',
    });
    // 링크 paragraph 는 있지만, body paragraph 는 없어야.
    const paragraphs = blocks.filter(
      (b): b is Exclude<typeof b, { type: 'divider' }> =>
        b.type === 'paragraph',
    );
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].text.startsWith('링크')).toBe(true);
  });
});
