import { BackfillPricesResult } from '../application/backfill-universe-prices.usecase';

export const formatBackfillSummary = (result: BackfillPricesResult): string => {
  const lines = [
    `유니버스 과거 시세 수집을 마쳤습니다. 대상 ${result.targetCount}종목 중 목표 도달 ${result.succeeded}종목, 기존 이력 충분 ${result.skipped}종목, 공급자 이력 소진 ${result.exhausted}종목(정상 종료), ${result.failed}종목 실패, ${result.pagesFetched}페이지 조회, 일봉 ${result.written}건 저장, 장중 ${result.blockedIntraday}건 차단했습니다.`,
  ];
  // 소진과 같은 칸에 담으면 "정상 종료" 로 읽혀 공급자 이상이 묻힌다. 목표까지 받지
  // 못하고 끊긴 것이므로 따로 세우고 사유를 적는다.
  if (result.stalled > 0) {
    lines.push(
      `⚠ 커서가 진전하지 않아 끊은 종목 ${result.stalled}종목 — 같은 페이지가 반복됐다는 뜻이며 목표 기간까지 받지 못했습니다.`,
    );
  }
  return lines.join('\n');
};
