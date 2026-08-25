import {
  MINIMUM_CLOSED_SAMPLE,
  RecommendationScorecardRow,
  renderRecommendationScorecard,
} from './recommendation-scorecard';

const row = (
  overrides: Partial<RecommendationScorecardRow> = {},
): RecommendationScorecardRow => ({
  asOf: new Date('2026-08-21'),
  closedCount: 10,
  hitCount: 3,
  meanReturnRate: -0.0393,
  meanExcessReturnRate: -0.0206,
  maximumLoss: -0.1943,
  ...overrides,
});

describe('renderRecommendationScorecard', () => {
  it('채점 이력이 없으면 빈 문자열 — 프롬프트에 아무것도 더하지 않는다', () => {
    expect(renderRecommendationScorecard([])).toBe('');
  });

  it('회차별 성적을 한 줄씩 싣는다', () => {
    const rendered = renderRecommendationScorecard([
      row({ asOf: new Date('2026-08-21'), closedCount: 10, hitCount: 3 }),
      row({ asOf: new Date('2026-08-19'), closedCount: 6, hitCount: 1 }),
    ]);

    expect(rendered).toContain('2026-08-21');
    expect(rendered).toContain('청산 10건');
    expect(rendered).toContain('2026-08-19');
    expect(rendered).toContain('청산 6건');
  });

  it('청산 표본이 차면 합산 적중률을 적는다', () => {
    const rendered = renderRecommendationScorecard([
      row({ closedCount: 10, hitCount: 3 }),
      row({ asOf: new Date('2026-08-19'), closedCount: 6, hitCount: 1 }),
    ]);

    // 4/16 = 25%
    expect(rendered).toContain('청산 16건 중 적중 4건');
    expect(rendered).toContain('25%');
  });

  it('청산 표본이 모자라면 비율을 내지 않는다 — 적은 표본의 비율은 추측이다', () => {
    const rendered = renderRecommendationScorecard([
      row({ closedCount: MINIMUM_CLOSED_SAMPLE - 1, hitCount: 1 }),
    ]);

    expect(rendered).toContain('표본 부족');
    expect(rendered).not.toMatch(/적중률 \d+%/);
  });

  it('초과수익이 마이너스면 지수를 못 따라갔다고 명시한다', () => {
    const rendered = renderRecommendationScorecard([
      row({ meanExcessReturnRate: -0.0206 }),
      row({ asOf: new Date('2026-08-19'), meanExcessReturnRate: -0.0044 }),
    ]);

    expect(rendered).toContain('지수를 따라가지 못했다');
  });

  it('초과수익이 플러스면 그 문장을 넣지 않는다', () => {
    const rendered = renderRecommendationScorecard([
      row({ meanExcessReturnRate: 0.012 }),
      row({ asOf: new Date('2026-08-19'), meanExcessReturnRate: 0.008 }),
    ]);

    expect(rendered).not.toContain('지수를 따라가지 못했다');
  });

  it('결측 지표는 칸을 비우고 나머지를 싣는다 — 지수 결손 회차가 통째로 빠지지 않게', () => {
    const rendered = renderRecommendationScorecard([
      row({ meanExcessReturnRate: null, meanReturnRate: null }),
      row({ asOf: new Date('2026-08-19') }),
    ]);

    expect(rendered).toContain('청산 10건');
    expect(rendered).not.toContain('NaN');
  });

  it('매수 종수를 채울 의무가 없다는 처방을 함께 싣는다', () => {
    const rendered = renderRecommendationScorecard([
      row(),
      row({ asOf: new Date('2026-08-19') }),
    ]);

    expect(rendered).toContain('채울 의무가 없다');
  });

  it('최신 회차가 먼저 오도록 정렬한다', () => {
    const rendered = renderRecommendationScorecard([
      row({ asOf: new Date('2026-08-19') }),
      row({ asOf: new Date('2026-08-21') }),
    ]);

    expect(rendered.indexOf('2026-08-21')).toBeLessThan(
      rendered.indexOf('2026-08-19'),
    );
  });
});
