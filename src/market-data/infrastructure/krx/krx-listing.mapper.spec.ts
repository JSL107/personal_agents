import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { KrxListingClient } from './krx-listing.client';
import { parseKrxListingHtml } from './krx-listing.mapper';

const row = ({
  code,
  marketCell,
  name = '회사',
  sector = '전기전자',
  listedAt = '1975-06-11',
}: {
  code: string;
  marketCell: string;
  name?: string;
  sector?: string;
  listedAt?: string;
}): string => {
  return `<tr>
    <td><strong>${name}</strong></td>
    <td> ${marketCell} </td>
    <td style="mso-number-format:'@';">${code}</td>
    <td>${sector}</td><td>제품</td><td>${listedAt}</td>
    <td>12월</td><td>대표</td><td>https://example.com</td><td>서울</td>
  </tr>`;
};

describe('parseKrxListingHtml', () => {
  it('실제 KRX 중복 응답에서 코드별 첫 행만 남긴다', () => {
    const html = readFileSync(
      join(__dirname, '__fixtures__', 'krx-kospi-sample.html'),
      'utf8',
    );

    const listings = parseKrxListingHtml(html, 'KOSPI');
    const codes = listings.map((listing) => listing.code);

    expect(listings).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    expect(codes).toEqual(['279570', '217590', '317450', '439260', '462520']);
  });

  it('10개 셀의 상장법인 행을 정규화한다', () => {
    const html = `<table>
      <tr><th>회사명</th><th>시장구분</th></tr>
      ${row({ code: '005930', marketCell: '유가', name: '삼성전자' })}
      ${row({
        code: '247540',
        marketCell: '코스닥',
        name: '에코프로비엠',
        sector: '',
        listedAt: '잘못된 날짜',
      })}
    </table>`;

    expect(parseKrxListingHtml(html, 'KOSDAQ')).toEqual([
      {
        code: '005930',
        name: '삼성전자',
        market: 'KOSPI',
        sector: '전기전자',
        listedAt: new Date('1975-06-11T00:00:00.000Z'),
      },
      {
        code: '247540',
        name: '에코프로비엠',
        market: 'KOSDAQ',
        sector: null,
        listedAt: null,
      },
    ]);
  });

  it('시장 판정은 회사명 속 유가가 아니라 두 번째 셀만 사용한다', () => {
    const html = row({
      code: '123456',
      marketCell: '기타',
      name: '유가테크',
    });

    expect(parseKrxListingHtml(html, 'KOSDAQ')[0].market).toBe('KOSDAQ');
  });

  it('6자리 숫자가 아닌 종목코드 행을 건너뛴다', () => {
    const html = [
      row({ code: '00593', marketCell: '유가' }),
      row({ code: 'A05930', marketCell: '유가' }),
      row({ code: '005930', marketCell: '유가' }),
    ].join('');

    expect(parseKrxListingHtml(html, 'KOSPI').map(({ code }) => code)).toEqual([
      '005930',
    ]);
  });

  it('유효한 상장법인 행이 없으면 오류를 던진다', () => {
    expect(() =>
      parseKrxListingHtml('<table><tr><th>회사명</th></tr></table>', 'KOSPI'),
    ).toThrow('KRX 상장법인 목록');
  });
});

const listingHtml = (count: number, marketCell: string): string => {
  return Array.from({ length: count }, (_, index) =>
    row({ code: String(index).padStart(6, '0'), marketCell }),
  ).join('');
};

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolvePromise!: (value: T) => void;
  return {
    promise: new Promise<T>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: resolvePromise,
  };
};

describe('KrxListingClient', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('KOSPI 응답이 끝난 뒤 KOSDAQ을 호출하고 합친다', async () => {
    const firstResponse = deferred<Response>();
    fetchMock
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce(new Response(listingHtml(500, '코스닥')));
    const pending = new KrxListingClient().fetchListings();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('marketType=stockMkt');

    firstResponse.resolve(new Response(listingHtml(1_500, '유가')));
    await expect(pending).resolves.toHaveLength(2_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      'marketType=kosdaqMkt',
    );
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('EUC-KR 응답을 디코드한다', async () => {
    const prefix = new TextEncoder().encode('<tr><td>');
    const suffix = new TextEncoder().encode(
      '</td><td>기타</td><td>000000</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>',
    );
    const encodedName = Uint8Array.from([0xb0, 0xa1]);
    const encodedRow = new Uint8Array(
      prefix.length + encodedName.length + suffix.length,
    );
    encodedRow.set(prefix);
    encodedRow.set(encodedName, prefix.length);
    encodedRow.set(suffix, prefix.length + encodedName.length);
    fetchMock
      .mockResolvedValueOnce(new Response(encodedRow))
      .mockResolvedValueOnce(new Response(listingHtml(1_999, '코스닥')));

    const listings = await new KrxListingClient().fetchListings();

    expect(listings[0].name).toBe('가');
  });

  it('HTTP 오류면 즉시 중단한다', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));

    await expect(new KrxListingClient().fetchListings()).rejects.toThrow(
      'HTTP 503',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('두 시장 합계가 2,000건 미만이면 잘린 응답으로 보고 오류를 던진다', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(listingHtml(829, '유가')))
      .mockResolvedValueOnce(new Response(listingHtml(900, '코스닥')));

    await expect(new KrxListingClient().fetchListings()).rejects.toThrow(
      '2,000',
    );
  });

  it('각 요청에 30초 타임아웃을 건다', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    fetchMock
      .mockResolvedValueOnce(new Response(listingHtml(1_000, '유가')))
      .mockResolvedValueOnce(new Response(listingHtml(1_000, '코스닥')));

    try {
      await new KrxListingClient().fetchListings();
      expect(timeoutSpy).toHaveBeenNthCalledWith(1, 30_000);
      expect(timeoutSpy).toHaveBeenNthCalledWith(2, 30_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });
});
