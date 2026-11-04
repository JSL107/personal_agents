import { computeCandidateExpiresAt } from './business-day-add';

describe('computeCandidateExpiresAt', () => {
  const noHoliday = (): boolean => false;

  it('금요일 등록은 다음 목요일 00:00 KST에 만료한다', () => {
    expect(
      computeCandidateExpiresAt(
        new Date('2026-11-06T06:00:00Z'),
        noHoliday,
      ).toISOString(),
    ).toBe('2026-11-11T15:00:00.000Z');
  });

  it('토요일 등록은 월요일부터 세어 목요일 00:00 KST에 만료한다', () => {
    expect(
      computeCandidateExpiresAt(
        new Date('2026-11-07T06:00:00Z'),
        noHoliday,
      ).toISOString(),
    ).toBe('2026-11-11T15:00:00.000Z');
  });

  it('중간 수요일 공휴일은 만료를 하루 늦춘다', () => {
    expect(
      computeCandidateExpiresAt(
        new Date('2026-11-06T06:00:00Z'),
        (date) => date.year === 2026 && date.month === 11 && date.day === 11,
      ).toISOString(),
    ).toBe('2026-11-12T15:00:00.000Z');
  });
});
