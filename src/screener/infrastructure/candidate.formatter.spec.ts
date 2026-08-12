import { RankCandidatesResult } from '../application/rank-candidates.usecase';
import { StockIndicator } from '../domain/indicator.type';
import { formatCandidates } from './candidate.formatter';

const buildCandidate = (code: string, name: string): StockIndicator => ({
  tickerId: 1,
  code,
  name,
  krxMarket: 'KOSPI',
  lastTradeDate: '2026-08-11',
  lastClose: 239_000,
  barCount: 200,
  ma5: 238_000,
  ma20: 230_000,
  ma60: 220_000,
  ma120: 210_000,
  isAligned: true,
  isUptrend: true,
  disparity20: 1.039,
  volumeSurge: 2.15,
  return20: 0.081,
  return60: 0.152,
  return120: 0.243,
  high200Position: 0.98,
  volatility20: 0.0182,
  turnover60: 812_000_000_000,
});

describe('formatCandidates', () => {
  it('집계와 전략별 후보를 한국어로 출력한다', () => {
    const result: RankCandidatesResult = {
      universeCount: 2_599,
      evaluatedCount: 2_400,
      skippedCount: 199,
      longTerm: [buildCandidate('005930', '삼성전자')],
      swing: [buildCandidate('000660', 'SK하이닉스')],
    };

    const output = formatCandidates(result);

    expect(output).toContain('유니버스 2599종목');
    expect(output).toContain('평가 2400');
    expect(output).toContain('제외 199');
    expect(output).toContain('장투 후보');
    expect(output).toContain('단타 후보');
    expect(output).toContain('005930');
    expect(output).toContain('삼성전자');
    expect(output).toContain('000660');
  });

  it('후보가 없으면 없음을 표시한다', () => {
    const result: RankCandidatesResult = {
      universeCount: 0,
      evaluatedCount: 0,
      skippedCount: 0,
      longTerm: [],
      swing: [],
    };

    const output = formatCandidates(result);

    expect(output).toContain('장투 후보: 없음');
    expect(output).toContain('단타 후보: 없음');
  });
});
