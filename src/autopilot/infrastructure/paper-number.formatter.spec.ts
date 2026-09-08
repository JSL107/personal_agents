import { formatKstTime, formatTradeDay } from './paper-number.formatter';

describe('paper-number.formatter', () => {
  describe('formatTradeDay', () => {
    it('거래일을 월/일(요일)로 적는다', () => {
      expect(formatTradeDay('2026-09-08')).toBe('9/8(화)');
      expect(formatTradeDay('2026-08-19')).toBe('8/19(수)');
    });

    // KST 날짜 문자열을 그대로 받는다. 로컬 타임존으로 파싱하면 UTC-9 지역에서 하루가
    // 밀려, 카드가 체결일을 전날로 적는다.
    it('타임존과 무관하게 받은 날짜를 그대로 읽는다', () => {
      expect(formatTradeDay('2026-01-01')).toBe('1/1(목)');
      expect(formatTradeDay('2026-12-31')).toBe('12/31(목)');
    });
  });

  describe('formatKstTime', () => {
    it('자정 기준 분을 두 자리 시:분으로 적는다', () => {
      expect(formatKstTime(9 * 60 + 32)).toBe('09:32');
      expect(formatKstTime(15 * 60 + 5)).toBe('15:05');
      expect(formatKstTime(0)).toBe('00:00');
    });
  });
});
