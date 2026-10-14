import { isCujCheckMissingYesterday } from './cuj-check-missing';

describe('isCujCheckMissingYesterday', () => {
  it('이전 실행이 있으나 어제 원장이 없으면 알린다', () => {
    expect(
      isCujCheckMissingYesterday(
        '2026-10-17',
        new Date('2026-10-15T00:10:00Z'),
      ),
    ).toBe(true);
  });

  it('어제 원장이 있으면 조용하다', () => {
    expect(
      isCujCheckMissingYesterday(
        '2026-10-16',
        new Date('2026-10-15T00:10:00Z'),
      ),
    ).toBe(false);
  });

  it('첫 실행 전에는 조용하다', () => {
    expect(isCujCheckMissingYesterday('2026-10-15', null)).toBe(false);
  });

  it('KST 자정 직전 UTC 전날 기록은 전전날로 본다', () => {
    expect(
      isCujCheckMissingYesterday(
        '2026-10-17',
        new Date('2026-10-15T14:59:59Z'),
      ),
    ).toBe(true);
    expect(
      isCujCheckMissingYesterday(
        '2026-10-17',
        new Date('2026-10-15T15:00:00Z'),
      ),
    ).toBe(false);
  });
});
