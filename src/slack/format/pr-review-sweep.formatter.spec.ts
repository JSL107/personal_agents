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

const harvest = (overrides = {}) => ({
  acked: 0,
  rejected: 0,
  fixed: 0,
  stale: 0,
  resolved: 0,
  judged: 0,
  skipped: 0,
  ...overrides,
});

describe('formatPrReviewSweep', () => {
  it('PR 별 게시 결과를 한 줄씩 렌더한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest(),
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
    // 0인 카운터는 숨겨진다
    expect(text).not.toContain('파일 0');
    expect(text).not.toContain('연습 0');
    expect(text).not.toContain('중복 0');
  });

  it('연습 모드 건수는 별도로 표기한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest(),
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
      harvest: harvest(),
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
    expect(formatPrReviewSweep({ harvest: harvest(), results: [] })).toBe('');
  });

  it('본문에 Slack 제어문자가 있어도 escape 한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest(),
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

  it('모든 카운터가 0이면 게시 없음으로 표기한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest(),
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'low',
          outcome: outcome(),
        },
      ],
    });

    expect(text).toContain('게시 없음');
    expect(text).toContain('🟢 `a/b#1` —');
  });

  it('수확 결과는 0이 아닌 항목만 한 줄로 렌더한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 2,
        rejected: 1,
        stale: 3,
        resolved: 3,
      }),
      results: [],
    });

    expect(text).toContain('👍 2 · 👎 1 · 종료 3 · 스레드 정리 3');
    expect(text).not.toContain('판정');
    expect(text).not.toContain('skip');
  });

  it('수확 결과가 전부 0이면 수확 줄을 생략한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest(),
      results: [
        {
          prRef: 'a/b#1',
          riskLevel: 'low',
          outcome: outcome({ inline: 1 }),
        },
      ],
    });

    expect(text).not.toContain('👍');
    expect(text).not.toContain('👎');
    expect(text).not.toContain('스레드 정리');
  });

  it('판정·미결만 있으면 사용자에게 보낼 수확 결과가 아니다', () => {
    expect(
      formatPrReviewSweep({
        harvest: harvest({ judged: 2, skipped: 1 }),
        results: [],
      }),
    ).toBe('');
  });
});
