import { CollectPricesResult } from '../application/collect-universe-prices.usecase';

export const formatPriceCollectionSummary = (
  result: CollectPricesResult,
): string =>
  `유니버스 시세 수집을 마쳤습니다. 대상 ${result.targetCount}종목 중 ${result.succeeded}종목 성공, ${result.failed}종목 실패, 일봉 ${result.written}건 저장, 장중 ${result.blockedIntraday}건 차단, 조정가 ${result.readjusted}종목 재수집, 429 재시도 성공 ${result.retried}종목입니다.`;
