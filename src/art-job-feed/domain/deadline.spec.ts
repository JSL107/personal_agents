import { deadlineDateOf, normalizeDeadline } from './deadline';

const TODAY = { year: 2026, month: 10, day: 13 };

describe('normalizeDeadline', () => {
  it.each([
    ['채용시', '상시', false],
    ['상시', '상시', false],
    ['오늘마감', '오늘 마감', true],
    ['내일마감', '내일 마감', true],
    ['D-2', 'D-2', true],
    ['D-12', 'D-12', false],
    ['~10/31', '~10/31 D-18', false],
    ['~10/15(목)', '~10/15 D-2', true],
    ['~10/13', '오늘 마감', true],
  ])('%s → %s', (raw, label, urgent) => {
    expect(normalizeDeadline(raw, TODAY)).toEqual({ label, urgent });
  });

  it('12월에 본 1월 마감은 내년으로 센다', () => {
    expect(
      normalizeDeadline('~1/2', { year: 2026, month: 12, day: 30 }),
    ).toEqual({ label: '~1/2 D-3', urgent: true });
  });

  it('없으면 null, 모르는 표기는 그대로 둔다', () => {
    expect(normalizeDeadline(null, TODAY)).toBeNull();
    expect(normalizeDeadline(' 접수마감 ', TODAY)).toEqual({
      label: '접수마감',
      urgent: false,
    });
  });
});

describe('deadlineDateOf', () => {
  it.each([
    ['~10/31(금)', { year: 2026, month: 10, day: 31 }],
    ['D-3', { year: 2026, month: 10, day: 16 }],
    ['오늘마감', TODAY],
    ['내일마감', { year: 2026, month: 10, day: 14 }],
    ['채용시', null],
    ['접수마감', null],
    [null, null],
  ])('%s → %o', (raw, date) => {
    expect(deadlineDateOf(raw, TODAY)).toEqual(date);
  });

  it('라벨과 같은 규칙으로 연도를 넘긴다 — 12월에 본 1월 마감은 내년', () => {
    expect(deadlineDateOf('~1/2', { year: 2026, month: 12, day: 30 })).toEqual({
      year: 2027,
      month: 1,
      day: 2,
    });
  });
});
