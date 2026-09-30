import {
  exclusiveBizdateOf,
  parseNaverInvestorFlowRows,
} from './naver-investor-flow.client';

describe('exclusiveBizdateOf', () => {
  it.each([
    ['2023-01-02', '20230103'],
    ['2024-02-28', '20240229'],
    ['2025-12-31', '20260101'],
  ])('%s 당일을 포함하도록 다음 날짜 %s 를 보낸다', (throughDate, expected) => {
    expect(exclusiveBizdateOf(throughDate)).toBe(expected);
  });
});

describe('parseNaverInvestorFlowRows', () => {
  it('부호와 콤마가 포함된 수량을 bigint와 UTC 거래일로 변환한다', () => {
    expect(
      parseNaverInvestorFlowRows({
        trendList: [
          {
            bizdate: '20230102',
            foreignerPureBuyQuant: '-609,433',
            organPureBuyQuant: '+1,062,403',
            accumulatedTradingVolume: '10,031,448',
          },
        ],
      }),
    ).toEqual([
      {
        tradeDate: new Date('2023-01-02T00:00:00.000Z'),
        foreignNetBuy: -609433n,
        institutionNetBuy: 1062403n,
        flowVolume: 10031448n,
      },
    ]);
  });

  // 2026-09-30 실측: 000040 의 거래정지일(20260907 등)은 거래량이 '-', 순매수가 '0' 으로 온다.
  // 이 한 행을 거부하면 페이지가 통째로 실패해 그 종목은 백필이 영영 끝나지 않는다.
  it("거래가 없던 날의 '-' 는 수량 0 으로 읽는다", () => {
    expect(
      parseNaverInvestorFlowRows([
        {
          bizdate: '20260907',
          foreignerPureBuyQuant: '0',
          organPureBuyQuant: '0',
          accumulatedTradingVolume: '-',
        },
      ]),
    ).toEqual([
      {
        tradeDate: new Date('2026-09-07T00:00:00.000Z'),
        foreignNetBuy: 0n,
        institutionNetBuy: 0n,
        flowVolume: 0n,
      },
    ]);
  });

  it.each([
    {
      bizdate: '20230230',
      foreignerPureBuyQuant: '1',
      organPureBuyQuant: '1',
      accumulatedTradingVolume: '1',
    },
    {
      bizdate: '20230102',
      foreignerPureBuyQuant: '',
      organPureBuyQuant: '1',
      accumulatedTradingVolume: '1',
    },
    {
      bizdate: '20230102',
      foreignerPureBuyQuant: 'bad',
      organPureBuyQuant: '1',
      accumulatedTradingVolume: '1',
    },
  ])('날짜나 수량이 비었거나 잘못된 행은 거부한다', (row) => {
    expect(() => parseNaverInvestorFlowRows([row])).toThrow('파싱 실패');
  });
});
