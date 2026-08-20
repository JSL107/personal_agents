import { StockIndicators } from '../../market-data/domain/stock-indicator';
import { ScreenUniverseResult } from '../application/screen-universe.usecase';
import { formatScreenResult } from './screen-result.formatter';

const indicators: StockIndicators = {
  close: 130,
  ma5: 125,
  ma20: 120,
  ma60: 110,
  ma120: 100,
  isAligned: true,
  volumeSurge: 2.5,
  return1m: 12.34,
  return3m: 20,
  return6m: 45.67,
  high200Position: 0.9,
  volatility20: 18.9,
  turnover60: 650_000_000,
  barCount: 200,
};

const result = (strategy: 'LONG_TERM' | 'SWING'): ScreenUniverseResult => ({
  strategy,
  ruleVersion: 1,
  universeCount: 2_595,
  evaluatedCount: 2_500,
  staleCount: 5,
  passedCount: 100,
  includedIndicators: [],
  stocks: [
    {
      tickerId: 1,
      code: '005930',
      name: '삼성전자',
      krxMarket: 'KOSPI',
      score: 91.23,
      indicators,
    },
  ],
  asOf: '2026-08-12',
  recordOutcome: null,
});

describe('formatScreenResult', () => {
  it('장투 표에는 6개월 수익률과 20일 변동성을 출력한다', () => {
    const output = formatScreenResult(result('LONG_TERM'));

    expect(output).toContain(
      '순위\t종목코드\t종목명\t시장\t점수\tturnover60(억원)',
    );
    expect(output).toContain('기준일 제외 5종목');
    expect(output).toContain('return6m\tvolatility20');
    expect(output).toContain(
      '1\t005930\t삼성전자\tKOSPI\t91.23\t7\t45.67%\t18.90%',
    );
  });

  it('단타 표에는 거래량 급증률과 1개월 수익률을 출력한다', () => {
    const output = formatScreenResult(result('SWING'));

    expect(output).toContain('turnover60(억원)\tvolumeSurge\treturn1m');
    expect(output).toContain(
      '1\t005930\t삼성전자\tKOSPI\t91.23\t7\t2.50x\t12.34%',
    );
  });

  it('통과 0건이면 유니버스와 봉 보유 종목 수를 이유로 출력한다', () => {
    const output = formatScreenResult({
      ...result('LONG_TERM'),
      evaluatedCount: 2_300,
      passedCount: 0,
      stocks: [],
    });

    expect(output).toBe(
      '스크리닝 통과 종목이 없습니다. 유니버스 2,595종목 중 봉이 있는 것 2,300종목, 기준일 제외 5종목, 통과 0건입니다.',
    );
  });
});
