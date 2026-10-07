import { Interval, RecommendationPromptInputs } from './selection-consistency';
import {
  decidePerformanceAction,
  decidePerformanceVerdict,
  pairedGap,
  performanceBlockKey,
  ruleCounterfactualPicks,
} from './selection-performance';

const inputs = (
  held: string[],
  candidates: string[],
): RecommendationPromptInputs => ({
  purchasableCash: 1_000_000,
  accountValuation: 1_000_000,
  positions: held.map((code) => ({ code, quantity: 1 })),
  candidates: candidates.map((code, index) => ({
    code,
    name: code,
    score: 100 - index,
    close: 1_000,
  })),
});

const interval = (lower: number, upper: number, blocks = 8): Interval => ({
  mean: (lower + upper) / 2,
  lower,
  upper,
  blocks,
  values: blocks * 2,
});

describe('ruleCounterfactualPicks', () => {
  it('보유 종목을 빼고 실린 순서대로 k 개를 고른다', () => {
    expect(
      ruleCounterfactualPicks(inputs(['A'], ['A', 'B', 'C', 'D']), 2),
    ).toEqual(['B', 'C']);
  });

  it('결정 시점 대기 매수 종목도 뺀다 — 운영이 모델 답 뒤에 걸러내는 종목이다', () => {
    expect(
      ruleCounterfactualPicks(
        inputs(['A'], ['A', 'B', 'C', 'D']),
        2,
        new Set(['B']),
      ),
    ).toEqual(['C', 'D']);
  });

  it('적격 후보가 k 보다 적으면 null', () => {
    expect(ruleCounterfactualPicks(inputs(['A'], ['A', 'B']), 2)).toBeNull();
  });
});

describe('pairedGap', () => {
  const returnByCode = new Map([
    ['A', 10],
    ['B', 2],
    ['C', -4],
  ]);

  it('겹친 종목은 상쇄되고 다르게 고른 것끼리의 차가 남는다', () => {
    expect(
      pairedGap({
        modelCodes: ['A', 'C'],
        ruleCodes: ['A', 'B'],
        returnByCode,
      }),
    ).toEqual({ gapPct: -3, overlapCount: 1, disagreementGapPct: -6 });
  });

  it('완전히 같으면 차이 0 · 불일치 차는 null', () => {
    expect(
      pairedGap({ modelCodes: ['A'], ruleCodes: ['A'], returnByCode }),
    ).toEqual({ gapPct: 0, overlapCount: 1, disagreementGapPct: null });
  });

  it('한 종목이라도 성적이 없으면 회차를 버린다', () => {
    expect(
      pairedGap({ modelCodes: ['A'], ruleCodes: ['Z'], returnByCode }),
    ).toBeNull();
  });

  it('기권(k=0)은 짝이 아니다', () => {
    expect(
      pairedGap({ modelCodes: [], ruleCodes: [], returnByCode }),
    ).toBeNull();
  });
});

describe('performanceBlockKey', () => {
  it('주 단위는 같은 주 월~금을 묶고 다음 주를 가른다', () => {
    const thursday = performanceBlockKey('SWING', new Date('2026-08-20'), 1);
    expect(performanceBlockKey('SWING', new Date('2026-08-17'), 1)).toBe(
      thursday,
    );
    expect(performanceBlockKey('SWING', new Date('2026-08-24'), 1)).not.toBe(
      thursday,
    );
  });

  it('4주 단위는 W34~W37 을 한 블록으로, W38 부터 다음 블록', () => {
    const first = performanceBlockKey('SWING', new Date('2026-08-20'), 4);
    expect(performanceBlockKey('SWING', new Date('2026-09-11'), 4)).toBe(first);
    expect(performanceBlockKey('SWING', new Date('2026-09-14'), 4)).not.toBe(
      first,
    );
  });

  it('전략이 다르면 다른 블록', () => {
    expect(performanceBlockKey('SWING', new Date('2026-08-20'), 1)).not.toBe(
      performanceBlockKey('LONG_TERM', new Date('2026-08-20'), 1),
    );
  });
});

describe('decidePerformanceVerdict', () => {
  it('블록이 8 미만이면 구간과 무관하게 INSUFFICIENT', () => {
    expect(decidePerformanceVerdict(interval(1, 2, 7), 0.5)).toBe(
      'INSUFFICIENT',
    );
    expect(decidePerformanceVerdict(null, 0.5)).toBe('INSUFFICIENT');
  });

  it.each([
    [0.1, 2, 'MODEL_BETTER'],
    [-2, -0.1, 'RULE_BETTER'],
    [-0.5, 0.5, 'EQUIVALENT'],
    [-0.6, 0.4, 'INCONCLUSIVE'],
    [-2, 2, 'INCONCLUSIVE'],
  ])('구간 [%p, %p] → %s', (lower, upper, expected) => {
    expect(decidePerformanceVerdict(interval(lower, upper), 0.5)).toBe(
      expected,
    );
  });
});

describe('decidePerformanceAction', () => {
  it('한 지평이라도 모델이 나으면 유지', () => {
    expect(decidePerformanceAction(['RULE_BETTER', 'MODEL_BETTER'])).toBe(
      'KEEP_MODEL',
    );
  });

  it('모두 규칙 우위이거나 동등이면 이전 설계', () => {
    expect(decidePerformanceAction(['RULE_BETTER', 'EQUIVALENT'])).toBe(
      'DESIGN_RULE_MIGRATION',
    );
  });

  it('한 지평이라도 표본 부족·불확정이면 보류', () => {
    expect(decidePerformanceAction(['RULE_BETTER', 'INSUFFICIENT'])).toBe(
      'HOLD',
    );
  });
});
