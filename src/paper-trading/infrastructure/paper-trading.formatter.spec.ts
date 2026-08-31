import { EvaluateAccountResult } from '../application/evaluate-paper-account.usecase';
import { PaperTradingStatusResult } from '../application/get-paper-trading-status.usecase';
import {
  formatPaperPortfolioStatus,
  formatPaperTradingReport,
  formatPaperTradingStatus,
} from './paper-trading.formatter';

const RESULT: EvaluateAccountResult = {
  skipped: false,
  tradeDate: '2026-08-11',
  cashBalance: '800000',
  settledCash: '700000',
  unsettledCash: '100000',
  dividendNetTotal: '0',
  dividendCount: 0,
  pendingDividendCash: '0',
  purchasableCash: '800000',
  nextDividendPayDate: null,
  positionValue: '240000',
  totalValue: '1040000',
  returnRate: '4',
  realizedPnl: '-15000',
  unrealizedPnl: '55000',
  benchmarkClose: null,
  positions: [
    {
      tickerId: 21,
      tickerCode: '005930',
      tickerName: '삼성<&>',
      quantity: '10',
      avgPrice: '10000',
      price: '12000',
      priceDate: '2026-08-11',
      marketValue: '120000',
      unrealizedPnl: '20000',
      returnRate: '20',
      isStale: false,
    },
    {
      tickerId: 22,
      tickerCode: '000660',
      tickerName: 'SK하이닉스',
      quantity: '2',
      avgPrice: '50000',
      price: '60000',
      priceDate: '2026-08-10',
      marketValue: '120000',
      unrealizedPnl: '20000',
      returnRate: '20',
      isStale: true,
    },
  ],
  unpricedPositions: [],
  positionCount: 2,
  staleTickerCount: 1,
  invariantViolations: [],
  suspiciousJumps: [],
};

describe('formatPaperTradingReport', () => {
  it('종목 행과 계좌 요약을 Slack mrkdwn으로 출력하고 종목명을 escape한다', () => {
    const text = formatPaperTradingReport(RESULT);

    expect(text).toContain('*가상 매매 장마감 평가 — 2026-08-11*');
    expect(text).toContain('*삼성&lt;&amp;&gt;* (`005930`)');
    expect(text).toContain(
      '10주 · 평단 10,000원 · 현재가 12,000원 · 평가액 120,000원 · 손익률 +20%',
    );
    expect(text).toContain('총 평가액 *1,040,000원*');
    expect(text).toContain('현금 800,000원');
    expect(text).toContain('총 수익률 *+4%*');
    expect(text).toContain('확정 손익 -15,000원 · 보유 평가손익 +55,000원');
  });

  // 총 수익률만 적힌 카드로는 "보유 종목은 전부 + 인데 총 수익률은 마이너스" 를 설명할 수
  // 없다. 이미 팔아 확정한 손익이 그 차이의 전부이므로 부호가 곧 뜻이고, 평단이 소수라
  // 손익도 소수로 떨어져 원 단위로 반올림해야 읽힌다.
  it('확정·평가 손익에 부호를 붙이고 원 단위로 반올림한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      realizedPnl: '-1522158.9988',
      unrealizedPnl: '207538.9988',
    });

    expect(text).toContain('확정 손익 -1,522,159원 · 보유 평가손익 +207,539원');
  });

  it('평가를 내지 못한 회차에는 손익 분해를 적지 않는다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      skipped: true,
      totalValue: null,
      returnRate: null,
      realizedPnl: null,
      unrealizedPnl: null,
    });

    expect(text).not.toContain('확정 손익');
  });

  it('stale 종목에 가격 기준일 표식을 붙인다', () => {
    const text = formatPaperTradingReport(RESULT);

    expect(text).toContain('SK하이닉스* (`000660`) _⚠️ stale: 2026-08-10_');
  });

  it('benchmarkClose가 null이면 벤치마크 줄을 생략한다', () => {
    const text = formatPaperTradingReport(RESULT);

    expect(text).not.toContain('벤치마크');
  });

  it('benchmarkClose가 있으면 벤치마크 종가를 표시한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      benchmarkClose: '2847.32',
    });

    expect(text).toContain('벤치마크 종가 2,847.32');
  });

  // 매수 대금이 아직 안 빠진 날은 D+0 이 D+2 보다 크다. 그 관계가 뒤집혀 보이지 않아야
  // 어느 쪽이 실제 잔고인지 읽힌다(RESULT 의 cashBalance 800,000 이 D+2 다).
  it('예수금을 D+0·D+2 로 갈라 표시한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      settledCash: '900000',
      unsettledCash: '-100000',
      dividendNetTotal: '1330319',
      dividendCount: 1,
      tradingRealizedPnl: '-1345319',
    });

    expect(text).toContain('예수금 D+0 900,000원 · D+2 800,000원');
    // 지급일이 지난 배당이라 잔고 전액이 매수 여력이다 — 적을 것이 없다.
    expect(text).not.toContain('미수 배당');
    // 배당은 손익 줄에서 매매분과 갈려 나온다. 별도 요약 줄을 두면 같은 금액이 카드에
    // 두 번 적혀 어느 쪽이 합계인지 흐려진다.
    expect(text).toContain('배당 1건 +1,330,319원');
  });

  // 실제 사고 값. 코람코더원리츠 특별배당은 8/28 락, 11/27 지급이라 석 달 동안 잔고에는
  // 있지만 쓸 수 없다. 그 줄이 없으면 D+2 잔고를 그대로 매수 여력으로 읽는다.
  it('지급일이 오지 않은 배당은 매수 가능액과 함께 따로 적는다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      cashBalance: '2106271',
      settledCash: '5417053',
      unsettledCash: '-3310782',
      dividendNetTotal: '1330319',
      dividendCount: 1,
      pendingDividendCash: '1330319',
      purchasableCash: '775952',
      nextDividendPayDate: '2026-11-27',
    });

    expect(text).toContain(
      '미수 배당 1,330,319원 (2026-11-27 지급) · 매수 가능 775,952원',
    );
  });

  // 실제 사고 값. realizedPnl(-191,840)만 내면 매매로 152만원을 잃은 사실이 배당에
  // 가려진다. 두 숫자가 갈려 있어야 추천 채점이 매매분만 볼 수 있다.
  it('배당이 있으면 확정 손익을 매매분과 배당으로 갈라 적는다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      realizedPnl: '-191840',
      tradingRealizedPnl: '-1522159',
      dividendNetTotal: '1330319',
      dividendCount: 1,
      unrealizedPnl: '150291',
    });

    expect(text).toContain(
      '매매 확정손익 -1,522,159원 · 배당 1건 +1,330,319원 · 보유 평가손익 +150,291원',
    );
    // 뭉뚱그린 옛 표기가 남아 있으면 두 값이 같은 카드에 공존해 어느 쪽이 매매분인지 흐려진다.
    expect(text).not.toContain('확정 손익 -191,840원');
  });

  // 배당이 없는 계좌는 가를 것이 없다. 없는 축을 굳이 만들면 0원 배당 줄이 매일 붙는다.
  it('배당이 없으면 확정 손익을 한 줄로 유지한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      realizedPnl: '-191840',
      tradingRealizedPnl: '-191840',
      dividendCount: 0,
      unrealizedPnl: '150291',
    });

    expect(text).toContain('확정 손익 -191,840원 · 보유 평가손익 +150,291원');
    expect(text).not.toContain('배당');
  });

  it('전일 스냅샷이 있으면 전일 대비 수익률을 적고 배당 반영분을 밝힌다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      returnRate: '-0.42',
      previousReturnRate: '-13.1462',
      previousTradeDate: '2026-08-28',
      dividendNetTotal: '1330319',
      dividendCount: 1,
    });

    expect(text).toContain(
      '전일 -13.15% → 오늘 -0.42% (배당 반영 +1,330,319원)',
    );
  });

  // 첫 평가일에는 비교 대상이 없다. 없는 값을 0%로 적으면 시드에서 급락한 것처럼 보인다.
  it('전일 스냅샷이 없으면 전일 대비 줄을 생략한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      previousReturnRate: null,
    });

    expect(text).not.toContain('전일');
  });

  it('포지션이 0건이면 보유 없음이라고 표시한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      positionValue: '0',
      totalValue: '800000',
      positions: [],
      positionCount: 0,
      staleTickerCount: 0,
    });

    expect(text).toContain('_보유 없음_');
  });

  it('보유 종목이 모두 unpriced여도 보유 없음으로 표시하지 않고 시세 미확보를 알린다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      skipped: true,
      skipReason: '1개 보유 종목의 평가 시세를 찾을 수 없습니다: 000660',
      positionValue: null,
      totalValue: null,
      returnRate: null,
      positions: [],
      unpricedPositions: [
        {
          tickerId: 22,
          tickerCode: '000660',
          tickerName: 'SK<&>',
          quantity: '2',
          avgPrice: '50000',
        },
      ],
      positionCount: 1,
      staleTickerCount: 0,
    });

    expect(text).not.toContain('보유 없음');
    expect(text).toContain('*평가 시세 미확보*');
    expect(text).toContain(
      '*SK&lt;&amp;&gt;* (`000660`) · 2주 · 평단 50,000원',
    );
  });

  it('평가가 차단되면 사유와 가용한 포지션 근거를 함께 표시한다', () => {
    const text = formatPaperTradingReport({
      ...RESULT,
      skipped: true,
      skipReason: '모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
      positionValue: null,
      totalValue: null,
      returnRate: null,
    });

    expect(text).toContain(
      '⚠️ 스냅샷 미적재 — 모든 보유 종목의 시세가 실행일보다 오래되었습니다.',
    );
    expect(text).toContain('*삼성&lt;&amp;&gt;* (`005930`)');
    expect(text).toContain('현금 800,000원');
  });
});

// 조회 응답 — findRecentSnapshots 가 tradeDate desc 로 주므로 최신이 [0] 이다.
// 날짜를 일부러 뒤섞지 않고 실제 정렬(내림차순)대로 두되, 수익률 값을 서로 다르게 해서
// 최신이 아닌 행을 집으면 단언이 깨지게 한다.
const STATUS: PaperTradingStatusResult = {
  account: {
    name: 'DEFAULT',
    seedAmount: '10000000',
    cashBalance: '3410000',
  },
  positions: [
    {
      tickerCode: '005930',
      tickerName: '삼성<&>',
      quantity: '10',
      avgPrice: '71000',
    },
  ],
  snapshots: [
    { tradeDate: '2026-08-12', totalValue: '10120000', returnRate: '1.2' },
    { tradeDate: '2026-08-11', totalValue: '10080000', returnRate: '0.8' },
  ],
};

describe('formatPaperTradingStatus', () => {
  it('최신 스냅샷 기준 수익률·평가액과 기준 날짜를 함께 출력한다', () => {
    const text = formatPaperTradingStatus(STATUS);

    expect(text).toContain('*가상 계좌 현황 — DEFAULT*');
    expect(text).toContain('최근 평가 (2026-08-12)');
    expect(text).toContain('총 평가액 *10,120,000원*');
    // 최신(+1.2%)이어야 한다 — 정렬을 잘못 집으면 전일(+0.8%)이 나온다.
    expect(text).toContain('수익률 *+1.2%*');
    expect(text).not.toContain('수익률 *+0.8%*');
    expect(text).toContain('시드 10,000,000원 · 현금 3,410,000원');
  });

  it('보유 종목 행을 출력하고 종목명을 escape 한다', () => {
    const text = formatPaperTradingStatus(STATUS);

    expect(text).toContain(
      '*삼성&lt;&amp;&gt;* (`005930`) · 10주 · 평단 71,000원',
    );
  });

  it('스냅샷이 2건 이상이면 최근 추이를 덧붙인다', () => {
    const text = formatPaperTradingStatus(STATUS);

    expect(text).toContain('*최근 추이*');
    expect(text).toContain('2026-08-12 +1.2% · 2026-08-11 +0.8%');
  });

  it('스냅샷이 1건이면 추이 섹션을 생략한다', () => {
    const text = formatPaperTradingStatus({
      ...STATUS,
      snapshots: [STATUS.snapshots[0]],
    });

    expect(text).not.toContain('*최근 추이*');
    expect(text).toContain('수익률 *+1.2%*');
  });

  it('스냅샷이 없으면 평가 미적재를 정직하게 알린다 (수익률을 지어내지 않음)', () => {
    const text = formatPaperTradingStatus({ ...STATUS, snapshots: [] });

    expect(text).toContain('아직 평가 스냅샷이 없어요');
    expect(text).not.toContain('수익률');
    // 스냅샷과 무관한 계좌 사실은 그대로 보여준다.
    expect(text).toContain('시드 10,000,000원 · 현금 3,410,000원');
  });

  it('보유가 0건이면 보유 종목 없음으로 표시한다', () => {
    const text = formatPaperTradingStatus({ ...STATUS, positions: [] });

    expect(text).toContain('_보유 종목 없음_');
  });

  it('손실이면 부호 없이 음수 수익률을 그대로 표시한다', () => {
    const text = formatPaperTradingStatus({
      ...STATUS,
      snapshots: [
        { tradeDate: '2026-08-12', totalValue: '9800000', returnRate: '-2.5' },
      ],
    });

    expect(text).toContain('수익률 *-2.5%*');
  });
});

describe('formatPaperPortfolioStatus', () => {
  // PAPER_RECOMMEND 는 전략명으로 계좌를 연다 (LONG_TERM / SWING).
  const SWING: PaperTradingStatusResult = {
    account: {
      name: 'SWING',
      seedAmount: '10000000',
      cashBalance: '9000000',
    },
    positions: [
      {
        tickerCode: '000660',
        tickerName: 'SK하이닉스',
        quantity: '5',
        avgPrice: '200000',
      },
    ],
    snapshots: [
      { tradeDate: '2026-08-12', totalValue: '9900000', returnRate: '-1' },
    ],
  };

  it('계좌마다 구분해 나란히 보여준다 (전략별 계좌가 하나로 뭉개지지 않는다)', () => {
    const text = formatPaperPortfolioStatus([
      { ...STATUS, account: { ...STATUS.account, name: 'LONG_TERM' } },
      SWING,
    ]);

    expect(text).toContain('*가상 계좌 현황 — LONG_TERM*');
    expect(text).toContain('*가상 계좌 현황 — SWING*');
    expect(text).toContain('---');
    // 전략별 수익률이 각각 살아 있어야 한다 (합산·평균으로 뭉개면 둘 다 사라진다).
    expect(text).toContain('수익률 *+1.2%*');
    expect(text).toContain('수익률 *-1%*');
  });

  it('계좌가 1개면 구분선 없이 그 계좌만 보여준다', () => {
    const text = formatPaperPortfolioStatus([SWING]);

    expect(text).toContain('*가상 계좌 현황 — SWING*');
    expect(text).not.toContain('---');
  });

  it('계좌가 없으면 계좌 부재를 알린다 (0원 수익률을 만들지 않음)', () => {
    const text = formatPaperPortfolioStatus([]);

    expect(text).toContain('가상 매매 계좌가 아직 없어요');
    // 안내 문장에는 "수익률" 이라는 낱말이 들어가지만, 수치가 붙은 수익률 값은 없어야 한다.
    expect(text).not.toMatch(/수익률 \*/u);
    expect(text).not.toContain('총 평가액');
  });
});
