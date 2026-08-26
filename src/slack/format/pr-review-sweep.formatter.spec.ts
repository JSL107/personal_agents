import { ADOPTION_WINDOW_DAYS } from '../../pr-review-loop/domain/adoption-rate';
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
  adoption: [],
  ...overrides,
});

const adoption = (
  category: string,
  total: number,
  ratePercent: number | null,
  changePercentPoint: number | null = null,
) => {
  // adopted + rejected === total 을 지킨다. 깨진 조합으로 검증하면 실제로는 나올 수 없는
  // 입력을 통과시키게 된다.
  const adopted =
    ratePercent === null ? total : Math.round((total * ratePercent) / 100);
  return {
    category,
    adopted,
    rejected: total - adopted,
    total,
    ratePercent,
    changePercentPoint,
  };
};

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

  it('구간 채택률을 카테고리별로 한 줄에 렌더한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('CORRECTNESS', 17, 94), adoption('TEST', 15, 100)],
      }),
      results: [],
    });

    expect(text).toContain('CORRECTNESS 94%(17)');
    expect(text).toContain('TEST 100%(15)');
  });

  it('표본이 미달인 카테고리는 비율 대신 표본 수를 보여준다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('RELIABILITY', 7, null)],
      }),
      results: [],
    });

    expect(text).toContain('RELIABILITY 표본 7');
    expect(text).not.toContain('%');
  });

  it('직전 구간 대비 변화를 화살표로 붙인다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [
          adoption('CORRECTNESS', 20, 90, 8),
          adoption('TEST', 30, 70, -12),
          adoption('RELIABILITY', 12, 83, 0),
        ],
      }),
      results: [],
    });

    expect(text).toContain('CORRECTNESS 90%(20) ↑8%p');
    expect(text).toContain('TEST 70%(30) ↓12%p');
    expect(text).toContain('RELIABILITY 83%(12) →');
  });

  it('기준선이 없으면 화살표를 붙이지 않는다', () => {
    // 직전 구간 표본이 미달이면 변화가 null 로 온다. 없는 기준선으로 그린 화살표는
    // 추세처럼 보이지만 잡음이다.
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('READABILITY', 11, 91, null)],
      }),
      results: [],
    });

    expect(text).toContain('READABILITY 91%(11)');
    expect(text).not.toContain('↑');
    expect(text).not.toContain('↓');
    expect(text).not.toContain('→');
  });

  it('채택률 줄에 구간 길이를 밝힌다', () => {
    // 누적인지 구간인지 안 적으면 읽는 사람이 전체 성적으로 오해한다.
    const text = formatPrReviewSweep({
      harvest: harvest({ acked: 1, adoption: [adoption('TEST', 15, 100)] }),
      results: [],
    });

    expect(text).toContain(`채택률(최근 ${ADOPTION_WINDOW_DAYS}일)`);
  });

  it('집계가 비면 채택률 줄을 생략한다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({ acked: 1 }),
      results: [],
    });

    expect(text).not.toContain('채택률');
  });

  it('채택률만 있고 수확·게시가 없으면 보낼 것이 없다', () => {
    expect(
      formatPrReviewSweep({
        harvest: harvest({ adoption: [adoption('TEST', 15, 100)] }),
        results: [],
      }),
    ).toBe('');
  });
});
