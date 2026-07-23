import {
  mapChartQuoteToDailyBar,
  mapQuoteToInstrument,
} from './yahoo-finance.mapper';

describe('mapQuoteToInstrument', () => {
  it('정상 응답을 종목 정보로 변환한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'SamsungElec',
        regularMarketPrice: 273500,
        currency: 'KRW',
        fullExchangeName: 'KSE',
      },
      '005930.KS',
    );

    expect(result).toEqual({
      yahooSymbol: '005930.KS',
      code: '005930',
      market: 'KOSPI',
      name: 'SamsungElec',
      currency: 'KRW',
    });
  });

  it('코스닥 접미사를 KOSDAQ 으로 매핑한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'ECOPROBM',
        regularMarketPrice: 111800,
        currency: 'KRW',
        fullExchangeName: 'KOSDAQ',
      },
      '247540.KQ',
    );

    expect(result?.market).toBe('KOSDAQ');
  });

  it('응답이 없으면 null 을 돌려준다', () => {
    expect(mapQuoteToInstrument(undefined, '005930')).toBeNull();
  });

  // 잘못된 접미사를 쓰면 Yahoo 는 예외 대신 shortName 이 심볼·ID 목록인
  // 오염된 응답을 준다. 실측: 005930.KQ → "005930.KQ,0P0000B2XZ,18569122"
  it('shortName 이 콤마 목록인 오염 응답을 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: '005930.KQ,0P0000B2XZ,18569122',
        regularMarketPrice: 84400,
        currency: 'KRW',
        fullExchangeName: 'KOSDAQ',
      },
      '005930.KQ',
    );

    expect(result).toBeNull();
  });

  it('shortName 이 심볼 문자열과 같으면 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: '005930.KQ',
        regularMarketPrice: 84400,
        currency: 'KRW',
        fullExchangeName: 'KOSDAQ',
      },
      '005930.KQ',
    );

    expect(result).toBeNull();
  });

  it('가격이 없으면 거부한다', () => {
    const result = mapQuoteToInstrument(
      { shortName: 'SamsungElec', currency: 'KRW', fullExchangeName: 'KSE' },
      '005930.KS',
    );

    expect(result).toBeNull();
  });

  it('Nasdaq prefix 미국 종목을 NASDAQ 으로 매핑한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'Apple',
        regularMarketPrice: 327,
        currency: 'USD',
        fullExchangeName: 'NasdaqGS',
      },
      'AAPL',
    );

    expect(result).toEqual({
      yahooSymbol: 'AAPL',
      code: 'AAPL',
      market: 'NASDAQ',
      name: 'Apple',
      currency: 'USD',
    });
  });

  it('NYSE 종목의 하이픈을 보존한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'Berkshire Hathaway',
        regularMarketPrice: 500,
        currency: 'USD',
        fullExchangeName: 'NYSE',
      },
      'BRK-B',
    );

    expect(result).toEqual({
      yahooSymbol: 'BRK-B',
      code: 'BRK-B',
      market: 'NYSE',
      name: 'Berkshire Hathaway',
      currency: 'USD',
    });
  });

  it('NYSEArca prefix ETF 를 NYSE 로 매핑한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'SPDR S&P 500 ETF Trust',
        regularMarketPrice: 630,
        currency: 'USD',
        fullExchangeName: 'NYSEArca',
      },
      'SPY',
    );

    expect(result?.market).toBe('NYSE');
  });

  it('알 수 없는 미국 거래소 응답을 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'Apple',
        regularMarketPrice: 327,
        currency: 'USD',
        fullExchangeName: 'OtherExchange',
      },
      'AAPL',
    );

    expect(result).toBeNull();
  });

  it('USD 가 아닌 접미사 없는 종목을 거부한다', () => {
    const result = mapQuoteToInstrument(
      {
        shortName: 'Apple',
        regularMarketPrice: 327,
        currency: 'KRW',
        fullExchangeName: 'NasdaqGS',
      },
      'AAPL',
    );

    expect(result).toBeNull();
  });
});

describe('mapChartQuoteToDailyBar', () => {
  it('정상 봉을 변환한다', () => {
    const result = mapChartQuoteToDailyBar(
      {
        date: new Date('2026-07-21T00:00:00.000Z'),
        close: 273500,
        adjclose: 273500,
        volume: 20380000,
      },
      'KRW',
    );

    expect(result?.tradeDate).toEqual(new Date('2026-07-21T00:00:00.000Z'));
    expect(result?.close.toString()).toBe('273500');
    expect(result?.volume).toBe(20380000n);
    expect(result?.currency).toBe('KRW');
  });

  it('adjclose 가 없으면 close 로 대체한다', () => {
    const result = mapChartQuoteToDailyBar(
      {
        date: new Date('2026-07-21T00:00:00.000Z'),
        close: 100,
        volume: 10,
      },
      'KRW',
    );

    expect(result?.adjClose.toString()).toBe('100');
  });

  it('종가가 없는 봉은 null 이다', () => {
    const result = mapChartQuoteToDailyBar(
      { date: new Date('2026-07-21T00:00:00.000Z'), volume: 10 },
      'KRW',
    );

    expect(result).toBeNull();
  });

  it('날짜가 없는 봉은 null 이다', () => {
    expect(
      mapChartQuoteToDailyBar({ close: 100, volume: 10 }, 'KRW'),
    ).toBeNull();
  });
});
