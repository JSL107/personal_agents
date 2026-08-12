import { EvaluateAccountResult } from '../application/evaluate-paper-account.usecase';
import { formatPaperTradingReport } from './paper-trading.formatter';

const RESULT: EvaluateAccountResult = {
  skipped: false,
  tradeDate: '2026-08-11',
  cashBalance: '800000',
  positionValue: '240000',
  totalValue: '1040000',
  returnRate: '4',
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
