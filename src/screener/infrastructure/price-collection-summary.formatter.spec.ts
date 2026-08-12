import { CollectPricesResult } from '../application/collect-universe-prices.usecase';
import { formatPriceCollectionSummary } from './price-collection-summary.formatter';

describe('formatPriceCollectionSummary', () => {
  it('CLI 요약에 429 재시도로 회복한 종목 수를 출력한다', () => {
    const result: CollectPricesResult = {
      targetCount: 120,
      succeeded: 119,
      failed: 1,
      written: 595,
      blockedIntraday: 0,
      readjusted: 2,
      retried: 5,
      failures: ['000020: rate limited'],
    };

    expect(formatPriceCollectionSummary(result)).toBe(
      '유니버스 시세 수집을 마쳤습니다. 대상 120종목 중 119종목 성공, 1종목 실패, 일봉 595건 저장, 장중 0건 차단, 조정가 2종목 재수집, 429 재시도 성공 5종목입니다.',
    );
  });
});
