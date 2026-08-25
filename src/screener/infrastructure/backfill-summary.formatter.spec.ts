import { BackfillPricesResult } from '../application/backfill-universe-prices.usecase';
import { formatBackfillSummary } from './backfill-summary.formatter';

describe('formatBackfillSummary', () => {
  it('공급자 이력 소진을 실패와 분리해 정상 종료로 출력한다', () => {
    const result: BackfillPricesResult = {
      targetCount: 120,
      skipped: 10,
      succeeded: 90,
      exhausted: 19,
      stalled: 0,
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

  // 커서 미진전은 목표까지 못 받고 끊긴 것이라 "정상 종료" 문구에 섞이면 장애가 묻힌다.
  it('커서 미진전으로 끊긴 종목은 경고 줄로 따로 알린다', () => {
    const result: BackfillPricesResult = {
      targetCount: 5,
      skipped: 0,
      succeeded: 3,
      exhausted: 1,
      stalled: 1,
      failed: 0,
      pagesFetched: 12,
      written: 2_000,
      blockedIntraday: 0,
      failures: [],
    };

    const formatted = formatBackfillSummary(result);

    expect(formatted).toContain('공급자 이력 소진 1종목(정상 종료)');
    expect(formatted).toContain('커서가 진전하지 않아 끊은 종목 1종목');
    expect(formatted).toContain('목표 기간까지 받지 못했습니다');
  });

  it('커서 미진전이 없으면 경고 줄을 붙이지 않는다', () => {
    const result: BackfillPricesResult = {
      targetCount: 1,
      skipped: 0,
      succeeded: 1,
      exhausted: 0,
      stalled: 0,
      failed: 0,
      pagesFetched: 6,
      written: 1_200,
      blockedIntraday: 0,
      failures: [],
    };

    expect(formatBackfillSummary(result)).not.toContain('커서가 진전하지');
  });
});
