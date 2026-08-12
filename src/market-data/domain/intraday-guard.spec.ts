import { isIntradayCapture } from './intraday-guard';

describe('isIntradayCapture', () => {
  it('오늘 봉을 KST 14:00에 받으면 장중 캡처로 판정한다', () => {
    expect(
      isIntradayCapture(
        new Date('2026-08-12T00:00:00.000Z'),
        new Date('2026-08-12T05:00:00.000Z'),
      ),
    ).toBe(true);
  });

  it('오늘 봉을 KST 17:10에 받으면 장중 캡처가 아니다', () => {
    expect(
      isIntradayCapture(
        new Date('2026-08-12T00:00:00.000Z'),
        new Date('2026-08-12T08:10:00.000Z'),
      ),
    ).toBe(false);
  });

  it('과거 봉은 KST 장중에 받아도 허용한다', () => {
    expect(
      isIntradayCapture(
        new Date('2026-08-11T00:00:00.000Z'),
        new Date('2026-08-12T05:00:00.000Z'),
      ),
    ).toBe(false);
  });

  it('UTC 전날이지만 KST 오늘 00:10이면 오늘 봉을 장중 캡처로 판정한다', () => {
    expect(
      isIntradayCapture(
        new Date('2026-08-12T00:00:00.000Z'),
        new Date('2026-08-11T15:10:00.000Z'),
      ),
    ).toBe(true);
  });

  it('KST 15:40부터 오늘 봉을 허용한다', () => {
    const tradeDate = new Date('2026-08-12T00:00:00.000Z');

    expect(
      isIntradayCapture(tradeDate, new Date('2026-08-12T06:39:59.999Z')),
    ).toBe(true);
    expect(
      isIntradayCapture(tradeDate, new Date('2026-08-12T06:40:00.000Z')),
    ).toBe(false);
  });
});
