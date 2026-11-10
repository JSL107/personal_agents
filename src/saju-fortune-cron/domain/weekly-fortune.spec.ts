import { FortuneScoreKey } from './saju-tables';
import {
  DailyScores,
  formatWeeklyFacts,
  isMondayKst,
  pickWeeklyHighlights,
  renderWeeklyStarLine,
  weekDatesFrom,
  WEEKDAYS,
} from './weekly-fortune';

// 항목마다 같은 점수를 깔고 총운만 바꿔 넣는다.
const weekOf = ({
  overall,
  others = {},
}: {
  overall: number[];
  others?: Partial<Record<FortuneScoreKey, number[]>>;
}): DailyScores[] =>
  WEEKDAYS.map((weekday, index) => ({
    date: `2026-11-${16 + index}`,
    weekday,
    scores: {
      총운: overall[index],
      '일·공부': others['일·공부']?.[index] ?? 3,
      '사람 관계': others['사람 관계']?.[index] ?? 3,
      돈: others['돈']?.[index] ?? 3,
      컨디션: others['컨디션']?.[index] ?? 3,
    },
  }));

describe('isMondayKst', () => {
  it.each([
    ['2026-11-16', true],
    ['2026-11-17', false],
    ['2027-02-01', true],
  ])('%s → %s', (todayKst, expected) => {
    expect(isMondayKst(todayKst)).toBe(expected);
  });
});

describe('weekDatesFrom', () => {
  it('연말을 넘겨 7일을 만든다', () => {
    expect(weekDatesFrom('2026-12-28')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
});

describe('pickWeeklyHighlights', () => {
  it('좋은 요일은 4점 이상 중 최고점, 동점이면 이른 요일', () => {
    const highlights = pickWeeklyHighlights(
      weekOf({ overall: [3, 5, 4, 5, 3, 3, 3] }),
    );

    expect(highlights['총운']).toEqual({ good: '화' });
  });

  it('조심할 요일은 2점, 동점이면 이른 요일', () => {
    const highlights = pickWeeklyHighlights(
      weekOf({ overall: [3, 2, 3, 3, 3, 2, 4] }),
    );

    expect(highlights['총운']).toEqual({ good: '일', careful: '화' });
  });

  it('전부 3점이면 좋은 요일도 조심할 요일도 없다', () => {
    const highlights = pickWeeklyHighlights(
      weekOf({ overall: [3, 3, 3, 3, 3, 3, 3] }),
    );

    expect(highlights['총운']).toEqual({});
    expect(highlights['돈']).toEqual({});
  });
});

describe('renderWeeklyStarLine', () => {
  it('요일별 총운을 한 줄로 그린다', () => {
    expect(
      renderWeeklyStarLine(weekOf({ overall: [3, 5, 4, 2, 3, 3, 4] })),
    ).toBe(
      '월 ★★★☆☆ · 화 ★★★★★ · 수 ★★★★☆ · 목 ★★☆☆☆ · 금 ★★★☆☆ · 토 ★★★☆☆ · 일 ★★★★☆',
    );
  });
});

describe('formatWeeklyFacts', () => {
  it('항목마다 한 줄, 요일이 없으면 요일을 쓰지 말라고 한다', () => {
    const facts = formatWeeklyFacts(
      weekOf({
        overall: [3, 5, 3, 3, 3, 2, 3],
        others: { 돈: [2, 3, 3, 3, 3, 3, 3] },
      }),
    );

    expect(facts).toEqual([
      '- 총운: 좋은 날 화요일, 조심할 날 토요일',
      '- 일·공부: 이번 주는 특별히 좋은 날도 조심할 날도 없다(요일을 쓰지 마라)',
      '- 사람 관계: 이번 주는 특별히 좋은 날도 조심할 날도 없다(요일을 쓰지 마라)',
      '- 돈: 조심할 날 월요일',
      '- 컨디션: 이번 주는 특별히 좋은 날도 조심할 날도 없다(요일을 쓰지 마라)',
    ]);
    expect(facts.join('\n')).not.toMatch(/[★☆]|\d/);
  });
});
