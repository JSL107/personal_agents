import { BackfillPricesResult } from '../application/backfill-universe-prices.usecase';

export const formatBackfillSummary = (result: BackfillPricesResult): string =>
  `유니버스 과거 시세 수집을 마쳤습니다. 대상 ${result.targetCount}종목 중 목표 도달 ${result.succeeded}종목, 기존 이력 충분 ${result.skipped}종목, 공급자 이력 소진 ${result.exhausted}종목(정상 종료), ${result.failed}종목 실패, ${result.pagesFetched}페이지 조회, 일봉 ${result.written}건 저장, 장중 ${result.blockedIntraday}건 차단했습니다.`;
