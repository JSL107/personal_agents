import { RecommendationScoreSummary } from '../../../../paper-trading/domain/recommendation-score';
import { SelectionGapSummary } from '../../../../screener/domain/screening-scorecard';
import {
  MINIMUM_EXCESS_SAMPLE,
  MINIMUM_GAP_RUN_COUNT,
  renderRecommendationScorecard,
} from './recommendation-scorecard';

const summary = (
  overrides: Partial<RecommendationScoreSummary> = {},
): RecommendationScoreSummary => ({
  asOf: new Date('2026-08-21'),
  closedCount: 9,
  hitCount: 2,
  meanReturnRate: -0.0059,
  meanExcessReturnRate: -0.0044,
  excessSampleCount: 11,
  maximumLoss: -0.0301,
  ...overrides,
});

const gap = (
  overrides: Partial<SelectionGapSummary> = {},
): SelectionGapSummary => ({
  horizonDays: 5,
  gapPct: 2.1,
  gapRunCount: 12,
  ...overrides,
});

describe('renderRecommendationScorecard', () => {
  it('채점 이력이 없으면 빈 문자열 — 프롬프트에 아무것도 더하지 않는다', () => {
    expect(renderRecommendationScorecard(null, gap())).toBe('');
  });

  it('최신 회차의 누적 성적을 그대로 싣는다 — 행끼리 더하지 않는다', () => {
    const rendered = renderRecommendationScorecard(summary(), gap());

    expect(rendered).toContain('청산 9건');
    expect(rendered).toContain('2026-08-21까지 누적');
  });

  it('절대 적중률을 싣지 않는다 — 하락장에서 모델이 관망하는 근거가 됐다', () => {
    const rendered = renderRecommendationScorecard(summary(), gap());

    expect(rendered).not.toContain('적중');
    expect(rendered).toContain('관망할 근거가 되지 않는다');
  });

  it('코스피 대비와 안 고른 후보 대비를 절대 성적보다 앞에 싣는다', () => {
    const rendered = renderRecommendationScorecard(
      summary({ meanExcessReturnRate: 0.0324 }),
      gap(),
    );

    expect(rendered).toContain('코스피보다 평균 +3.2%');
    expect(rendered).toContain('5거래일 뒤 평균 +2.1%p (비교 회차 12개)');
    expect(rendered.indexOf('코스피 대비')).toBeLessThan(
      rendered.indexOf('절대 성적'),
    );
    expect(rendered.indexOf('안 고른 후보 대비')).toBeLessThan(
      rendered.indexOf('절대 성적'),
    );
  });

  it('초과수익 표본이 모자라면 숫자로 내지 않는다 — 적은 표본의 평균은 추측이다', () => {
    const rendered = renderRecommendationScorecard(
      summary({ excessSampleCount: MINIMUM_EXCESS_SAMPLE - 1 }),
      gap(),
    );

    expect(rendered).toContain('코스피 대비: 추천 4건 — 표본 부족');
    expect(rendered).not.toContain('코스피보다 평균');
  });

  it('초과수익 표본 수는 청산 건수가 아니라 실제로 계산에 들어간 추천 수로 적는다', () => {
    const rendered = renderRecommendationScorecard(
      summary({ closedCount: 9, excessSampleCount: 11 }),
      gap(),
    );

    expect(rendered).toContain('(추천 11건, 보유 중 포함)');
  });

  it('표시 자릿수에서 0 이면 우열 대신 차이 없음으로 적는다', () => {
    const rendered = renderRecommendationScorecard(
      summary({ meanExcessReturnRate: 0.0004 }),
      gap({ gapPct: -0.04 }),
    );

    expect(rendered).toContain(
      '평균 0.0% (추천 11건, 보유 중 포함) — 지수와 차이가 없었다',
    );
    expect(rendered).toContain('평균 0.0%p (비교 회차 12개) — 차이가 없었다');
    expect(rendered).not.toContain('-0.0');
  });

  it('초과수익의 부호를 양쪽 다 문장으로 읽어 준다', () => {
    expect(
      renderRecommendationScorecard(
        summary({ meanExcessReturnRate: -0.0206 }),
        gap(),
      ),
    ).toContain('지수를 따라가지 못했다');
    expect(
      renderRecommendationScorecard(
        summary({ meanExcessReturnRate: 0.012 }),
        gap(),
      ),
    ).toContain('지수를 그냥 산 것보다 나았다');
  });

  it('초과수익이 결측이면 판정하지 않는다 — 지수 결손을 마이너스로 읽지 않게', () => {
    const rendered = renderRecommendationScorecard(
      summary({ meanExcessReturnRate: null }),
      gap(),
    );

    expect(rendered).toContain('산출하지 못했다');
    expect(rendered).not.toContain('지수를 따라가지 못했다');
  });

  it('선택 격차가 마이너스면 고른 종목이 더 못했다고 적는다', () => {
    const rendered = renderRecommendationScorecard(
      summary(),
      gap({ gapPct: -1.5 }),
    );

    expect(rendered).toContain('-1.5%p');
    expect(rendered).toContain('고른 종목이 더 못했다');
  });

  it('비교 회차가 모자라면 선택 격차를 숫자로 내지 않는다', () => {
    const rendered = renderRecommendationScorecard(
      summary(),
      gap({ gapRunCount: MINIMUM_GAP_RUN_COUNT - 1 }),
    );

    expect(rendered).toContain('비교 회차 4개 — 표본 부족');
    expect(rendered).not.toContain('%p');
  });

  it('비교할 회차가 없으면(격차 null) 표본 부족으로 적는다 — 0 으로 읽지 않게', () => {
    const rendered = renderRecommendationScorecard(
      summary(),
      gap({ gapPct: null, gapRunCount: 0 }),
    );

    expect(rendered).toContain('비교 회차 0개 — 표본 부족');
  });

  it('선택 격차 조회가 실패하면 그 줄만 비우고 나머지를 싣는다', () => {
    const rendered = renderRecommendationScorecard(summary(), null);

    expect(rendered).toContain('안 고른 후보 대비: 조회하지 못했다');
    expect(rendered).toContain('코스피 대비');
  });

  it('결측 지표는 칸을 비우고 나머지를 싣는다', () => {
    const rendered = renderRecommendationScorecard(
      summary({ meanReturnRate: null, maximumLoss: null }),
      gap(),
    );

    expect(rendered).toContain('청산 9건');
    expect(rendered).not.toContain('NaN');
  });

  it('매수 종수를 채울 의무가 없다는 처방을 함께 싣는다', () => {
    expect(renderRecommendationScorecard(summary(), gap())).toContain(
      '채울 의무가 없다',
    );
  });
});
