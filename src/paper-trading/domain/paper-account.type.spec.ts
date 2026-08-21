import { Prisma } from '@prisma/client';

import {
  assertWholeShares,
  parsePaperMarket,
  parseTradeDate,
  parseTradeSide,
  parseTradeStrategy,
} from './paper-account.type';

describe('paper account parsing guards', () => {
  it('매매 방향을 대소문자와 관계없이 파싱한다', () => {
    expect(parseTradeSide('buy')).toBe('BUY');
    expect(parseTradeSide('SELL')).toBe('SELL');
  });

  it('지원하지 않는 매매 방향이면 받은 값을 포함한 한국어 오류를 던진다', () => {
    expect(() => parseTradeSide('HOLD')).toThrow(
      '매매 방향이 올바르지 않습니다. 받은 값: HOLD',
    );
  });

  it('투자 전략을 대소문자와 관계없이 파싱한다', () => {
    expect(parseTradeStrategy('long_term')).toBe('LONG_TERM');
    expect(parseTradeStrategy('SWING')).toBe('SWING');
    expect(parseTradeStrategy('manual')).toBe('MANUAL');
  });

  it('지원하지 않는 투자 전략이면 받은 값을 포함한 한국어 오류를 던진다', () => {
    expect(() => parseTradeStrategy('DAY_TRADE')).toThrow(
      '투자 전략이 올바르지 않습니다. 받은 값: DAY_TRADE',
    );
  });

  it('시장을 대소문자와 관계없이 파싱한다', () => {
    expect(parsePaperMarket('kospi')).toBe('KOSPI');
    expect(parsePaperMarket('KOSDAQ')).toBe('KOSDAQ');
    expect(parsePaperMarket('konex')).toBe('KONEX');
  });

  it('지원하지 않는 시장이면 받은 값을 포함한 한국어 오류를 던진다', () => {
    expect(() => parsePaperMarket('NASDAQ')).toThrow(
      '가상 매매 시장이 올바르지 않습니다. 받은 값: NASDAQ',
    );
  });

  it('정수 수량을 허용한다', () => {
    expect(() => assertWholeShares(new Prisma.Decimal('10'))).not.toThrow();
  });

  it('소수 수량이면 받은 값을 포함한 한국어 오류를 던진다', () => {
    expect(() => assertWholeShares(new Prisma.Decimal('1.5'))).toThrow(
      '국내 주식 수량은 정수여야 합니다. 받은 값: 1.5',
    );
  });

  // 0 주 매수는 applyBuy 의 평균단가 계산에서 0 으로 나누기가 되어 avgPrice 가
  // Infinity/NaN 으로 DB 에 적재된다. 음수 수량은 매수인데 현금이 늘어난다.
  // 둘 다 존재할 수 없는 체결이므로 소수와 같은 자리에서 막아야 한다.
  it('수량 0 이면 오류를 던진다', () => {
    expect(() => assertWholeShares(new Prisma.Decimal('0'))).toThrow(
      '국내 주식 수량은 1주 이상이어야 합니다. 받은 값: 0',
    );
  });

  it('음수 수량이면 오류를 던진다', () => {
    expect(() => assertWholeShares(new Prisma.Decimal('-5'))).toThrow(
      '국내 주식 수량은 1주 이상이어야 합니다. 받은 값: -5',
    );
  });
});

describe('parseTradeDate', () => {
  it('YYYY-MM-DD 를 그날 UTC 자정으로 읽는다', () => {
    expect(parseTradeDate('2026-08-13').toISOString()).toBe(
      '2026-08-13T00:00:00.000Z',
    );
  });

  it('형식이 다르면 거부한다', () => {
    expect(() => parseTradeDate('2026-8-13')).toThrow(
      '체결일은 YYYY-MM-DD 형식이어야 합니다. 받은 값: 2026-8-13',
    );
  });

  // Date 는 없는 날짜를 다음 달로 굴려서 받아준다(2026-02-30 → 03-02). NaN 검사만으로는
  // 안 걸리므로 문자열로 되돌려 대조한다 — 체결일이 조용히 이틀 밀리면 그날 성적이 딴 날에 붙는다.
  it('달력에 없는 날짜가 다음 달로 굴러가는 것을 막는다', () => {
    expect(() => parseTradeDate('2026-02-30')).toThrow(
      '유효하지 않은 체결일입니다. 받은 값: 2026-02-30',
    );
  });
});
