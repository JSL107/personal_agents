import { BackfillPricesResult } from '../application/backfill-universe-prices.usecase';
import { formatBackfillSummary } from './backfill-summary.formatter';

describe('formatBackfillSummary', () => {
  it('공급자 이력 소진을 실패와 분리해 정상 종료로 출력한다', () => {
    const result: BackfillPricesResult = {
      targetCount: 120,
      skipped: 10,
      succeeded: 90,
      exhausted: 19,
      failed: 1,
      pagesFetched: 340,
      written: 67_500,
      blockedIntraday: 2,
      failures: ['000020: 상장폐지'],
    };

    expect(formatBackfillSummary(result)).toBe(
      '유니버스 과거 시세 수집을 마쳤습니다. 대상 120종목 중 목표 도달 90종목, 기존 이력 충분 10종목, 공급자 이력 소진 19종목(정상 종료), 1종목 실패, 340페이지 조회, 일봉 67500건 저장, 장중 2건 차단했습니다.',
    );
  });
});
