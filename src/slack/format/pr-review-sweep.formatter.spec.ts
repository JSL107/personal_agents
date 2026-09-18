import { ADOPTION_WINDOW_DAYS } from '../../pr-review-loop/domain/adoption-rate';
import { LEARNING_REPO } from '../../pr-review-loop/domain/learning-repo';
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
  contradicted: 0,
  quotaStopped: false,
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

  it('보류(contradicted)만 있어도 수확 줄에 실린다 — 사람이 봐야 하는 카드다', () => {
    // 👎 와 답글이 어긋나 확정을 미룬 카드. 이 값이 요약에서 빠지면 카드가 조용히
    // OPEN 에 쌓인다(카드 57 사고).
    const text = formatPrReviewSweep({
      harvest: harvest({ contradicted: 2 }),
      results: [],
    });

    expect(text).toContain('보류 2');
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

  // 이하 채택률 렌더는 "달라진 것만 앞세운다" 규약을 따른다. 전에는 카테고리 전량을 한 줄에
  // 이어 붙였고, 실제 발송 예(2026-09-18)는 카테고리 7개 · 숫자 15개가 한 줄에 들어갔다.
  it('전부 정상 범위면 수치 없이 개수로만 묶는다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('CORRECTNESS', 17, 94), adoption('TEST', 15, 100)],
      }),
      results: [],
    });

    expect(text).toContain('채택률 2종 모두 정상');
    expect(text).not.toContain('94%');
    expect(text).not.toContain('100%');
  });

  it('표본이 미달인 카테고리는 본문에도 집계에도 넣지 않는다', () => {
    // 표본 1~7 건으로 낸 비율은 판단 근거가 못 되고, 그 사실을 매번 알릴 값도 없다.
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('RELIABILITY', 7, null)],
      }),
      results: [],
    });

    expect(text).not.toContain('RELIABILITY');
    expect(text).not.toContain('채택률');
  });

  it('5%p 이상 떨어진 카테고리는 수치로 낸다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('TEST', 69, 94, -5)],
      }),
      results: [],
    });

    // 수치는 자기 줄에 선다 — 한 줄에 몰면 화면 폭에 눌려 낱말이 끊긴다.
    expect(text).toContain('\n• TEST 94%(69) ↓5%p');
    expect(text).not.toContain('모두 정상');
  });

  // 종전 구현은 notable 을 `' · '` 로 이어 붙였다. 단일 notable 만 검증하면 그 join 이 남아
  // 있어도 통과하므로, 고치려던 문제(한 줄 과밀)가 그대로 돌아올 수 있다.
  it('이상이 여럿이면 각각 자기 줄에 선다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [
          adoption('TEST', 69, 94, -6),
          adoption('CORRECTNESS', 30, 70, 0),
          adoption('RELIABILITY', 21, 100, 2),
        ],
      }),
      results: [],
    });

    expect(text).toContain('\n• TEST 94%(69) ↓6%p');
    expect(text).toContain('\n• CORRECTNESS 70%(30) →');
    expect(text).toContain('\n• 나머지 1종 정상');
    // 한 줄에 이어 붙이지 않는다.
    expect(text).not.toContain('↓6%p · ');
  });

  it('절대 수준이 80% 미만이면 떨어지지 않았어도 수치로 낸다', () => {
    // 변화가 없어도 낮은 채택률 자체가 신호다.
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('CORRECTNESS', 30, 70, 0)],
      }),
      results: [],
    });

    expect(text).toContain('\n• CORRECTNESS 70%(30) →');
  });

  it('보합은 이상으로 보지 않는다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [
          adoption('CORRECTNESS', 40, 90, 0),
          adoption('RELIABILITY', 30, 83, 2),
        ],
      }),
      results: [],
    });

    expect(text).toContain('채택률 2종 모두 정상');
  });

  // 오르는 것은 조치가 필요 없지만 묻어 두지도 않는다 — changePercentPoint 는 「규약을 실은 뒤
  // 그 카테고리가 나아졌나」 를 재는 유일한 자리다(adoption-rate.ts 필드 주석).
  it('5%p 이상 오른 카테고리도 수치로 낸다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('CORRECTNESS', 40, 90, 8)],
      }),
      results: [],
    });

    expect(text).toContain('\n• CORRECTNESS 90%(40) ↑8%p');
    expect(text).not.toContain('모두 정상');
  });

  // 회귀 고정 — 사용자가 실물로 지적한 회차를 그대로 넣는다. 원래는 카테고리 7개가
  // 한 줄에 나열됐고, 그중 실제로 볼 값은 TEST 의 하락 하나였다.
  it('실제 발송 회차(2026-09-18)는 하락 1건 + 나머지 개수로 줄어든다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [
          adoption('TEST', 69, 94, -5),
          adoption('CORRECTNESS', 55, 93, 0),
          adoption('RELIABILITY', 21, 100, 4),
          adoption('READABILITY', 16, 100),
          adoption('SECURITY', 7, null),
          adoption('ARCHITECTURE', 1, null),
          adoption('STYLE', 1, null),
        ],
      }),
      results: [],
    });

    expect(text).toContain('\n• TEST 94%(69) ↓5%p');
    expect(text).toContain('\n• 나머지 3종 정상');
    // 표본 미달 3종은 어느 형태로도 나오지 않는다.
    expect(text).not.toContain('SECURITY');
    expect(text).not.toContain('ARCHITECTURE');
    expect(text).not.toContain('STYLE');
  });

  it('기준선이 없으면 화살표를 붙이지 않는다', () => {
    // 직전 구간 표본이 미달이면 변화가 null 로 온다. 없는 기준선으로 그린 화살표는
    // 추세처럼 보이지만 잡음이다. 낮은 수준이라 본문에 올라가는 경우로 잡는다.
    const text = formatPrReviewSweep({
      harvest: harvest({
        acked: 1,
        adoption: [adoption('READABILITY', 11, 61, null)],
      }),
      results: [],
    });

    expect(text).toContain('\n• READABILITY 61%(11)');
    expect(text).not.toContain('↑');
    expect(text).not.toContain('↓');
    expect(text).not.toContain('→');
  });

  it('채택률 줄에 구간 길이와 집계 대상 레포를 밝힌다 — 이상 있을 때와 없을 때 모두', () => {
    // 누적인지 구간인지 안 적으면 읽는 사람이 전체 성적으로 오해한다.
    // 레포도 마찬가지다 — 이 숫자는 학습 규약이 실리는 레포 하나만 센 값이라,
    // 밝히지 않으면 여러 레포를 리뷰하는 사용자가 전체 성적으로 읽는다.
    const window = `최근 ${ADOPTION_WINDOW_DAYS}일 · \`${LEARNING_REPO}\``;

    const quiet = formatPrReviewSweep({
      harvest: harvest({ acked: 1, adoption: [adoption('TEST', 15, 100)] }),
      results: [],
    });
    expect(quiet).toContain(window);

    const noisy = formatPrReviewSweep({
      harvest: harvest({ acked: 1, adoption: [adoption('TEST', 30, 70, -9)] }),
      results: [],
    });
    expect(noisy).toContain(window);
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
  it('쿼터로 끊긴 회차는 카운터가 전부 0 이어도 중단을 알린다', () => {
    const text = formatPrReviewSweep({
      harvest: harvest({ skipped: 7 }),
      results: [],
      quotaStopped: true,
    });

    expect(text).toContain('쿼터 소진');
    // 잔량은 붙이지 않는다 — skipped 는 쿼터와 무관한 카드도 함께 세는 값이다.
    expect(text).not.toContain('7건');
  });

  it('쿼터 중단이 아니면 skipped 만으로는 아무것도 내지 않는다', () => {
    // skipped 는 "변경과 안 겹쳐 판정 대상이 아니었다" 도 함께 세는 카운터라,
    // 그 자체를 알림 사유로 쓰면 평상시 회차가 전부 잡음이 된다.
    const text = formatPrReviewSweep({
      harvest: harvest({ skipped: 7, judged: 2 }),
      results: [],
    });

    expect(text).toBe('');
  });
});
