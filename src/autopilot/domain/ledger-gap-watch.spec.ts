import { isLedgerGap } from './ledger-gap-watch';

describe('isLedgerGap', () => {
  describe('매일 작업 (1일 주기)', () => {
    it('이전 실행이 있으나 어제 원장이 없으면 알린다', () => {
      expect(
        isLedgerGap('2026-10-17', new Date('2026-10-15T00:10:00Z'), 1),
      ).toBe(true);
    });

    it('어제 원장이 있으면 조용하다', () => {
      expect(
        isLedgerGap('2026-10-16', new Date('2026-10-15T00:10:00Z'), 1),
      ).toBe(false);
    });

    it('첫 실행 전에는 조용하다', () => {
      expect(isLedgerGap('2026-10-15', null, 1)).toBe(false);
    });

    it('KST 자정 직전 UTC 전날 기록은 전전날로 본다', () => {
      expect(
        isLedgerGap('2026-10-17', new Date('2026-10-15T14:59:59Z'), 1),
      ).toBe(true);
      expect(
        isLedgerGap('2026-10-17', new Date('2026-10-15T15:00:00Z'), 1),
      ).toBe(false);
    });
  });

  describe('주간 작업 (7일 주기, 월 09:00)', () => {
    // 2026-10-12(월) 09:00 KST 회차
    const lastMonday = new Date('2026-10-12T00:00:00Z');

    it('다음 월요일 아침(회차 전)은 조용하다 — 7일 전 기록은 아직 주기 안이다', () => {
      expect(isLedgerGap('2026-10-19', lastMonday, 7)).toBe(false);
    });

    it('월요일 회차가 빠지면 화요일 아침에 알린다', () => {
      expect(isLedgerGap('2026-10-20', lastMonday, 7)).toBe(true);
    });

    it('월요일 회차가 밤늦게 밀려 돌아도 그날 기록이면 조용하다', () => {
      // 2026-10-19(월) 23:59 KST
      expect(
        isLedgerGap('2026-10-20', new Date('2026-10-19T14:59:00Z'), 7),
      ).toBe(false);
    });

    it('주중에는 지난 월요일 기록으로 조용하다', () => {
      expect(isLedgerGap('2026-10-18', lastMonday, 7)).toBe(false);
    });
  });
});
