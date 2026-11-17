import { formatPmPlanQuote } from './pm-plan-quote';

describe('formatPmPlanQuote', () => {
  it('최우선과 오전 항목 제목을 중복 없이 최대 3개 잇는다', () => {
    expect(
      formatPmPlanQuote({
        topPriority: { title: 'A' },
        morning: [
          { title: 'A' },
          { title: 'B' },
          { title: 'C' },
          { title: 'D' },
        ],
      }),
    ).toBe('A / B / C');
  });

  it('제목이 하나도 없으면 undefined', () => {
    expect(formatPmPlanQuote({ morning: [{ title: '  ' }] })).toBeUndefined();
    expect(formatPmPlanQuote(undefined)).toBeUndefined();
  });
});
