import { formatPrReviewSweep } from './pr-review-sweep.formatter';

const outcome = (overrides = {}) => ({
  inline: 0,
  file: 0,
  issueComment: 0,
  dryRun: 0,
  notPosted: 0,
  dropped: 0,
  duplicate: 0,
  ...overrides,
});

describe('formatPrReviewSweep', () => {
  it('PR 별 게시 결과를 한 줄씩 렌더한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'JSL107/personal_agents#180',
          riskLevel: 'high',
          outcome: outcome({ inline: 3, dropped: 1 }),
        },
      ],
    });

    expect(text).toContain('JSL107/personal_agents#180');
    expect(text).toContain('🔴');
    expect(text).toContain('인라인 3');
    expect(text).toContain('상한 초과 1');
  });

  it('연습 모드 건수는 별도로 표기한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'low',
          outcome: outcome({ dryRun: 2 }),
        },
      ],
    });

    expect(text).toContain('연습 2');
  });

  it('강등 건수를 표기한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'medium',
          outcome: outcome({ file: 1, issueComment: 2 }),
        },
      ],
    });

    expect(text).toContain('파일 1');
    expect(text).toContain('묶음 2');
  });

  it('결과가 없으면 빈 문자열', () => {
    expect(formatPrReviewSweep({ results: [] })).toBe('');
  });

  it('본문에 Slack 제어문자가 있어도 escape 한다', () => {
    const text = formatPrReviewSweep({
      results: [
        {
          prRef: 'a/b#1 <script>',
          riskLevel: 'low',
          outcome: outcome({ inline: 1 }),
        },
      ],
    });

    expect(text).not.toContain('<script>');
  });
});
