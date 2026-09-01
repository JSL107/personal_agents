import { Injectable } from '@nestjs/common';

import { getTodayKstDate } from '../../../common/util/kst-date.util';
import { KrxDelisting, parseKrxDelistingHtml } from './krx-delisting.mapper';

const KRX_DELISTING_URL = 'https://kind.krx.co.kr/investwarn/delcompany.do';
const REQUEST_TIMEOUT_MS = 60_000;
// 2000-01-06 부터 코스피 445 · 코스닥 1,043 건(2026-09-01 실측). 한 시장이 3,000 을 넘길 일은
// 당분간 없지만, 넘치면 조용히 잘리는 대신 아래 하한 검사가 잡도록 여유를 크게 둔다.
const PAGE_SIZE = 5_000;
// 전 기간을 매번 통째로 받는다. 코스피 445 + 코스닥 1,043 건(2026-09-01 실측)이 한 번에 오고,
// 구간을 좁히면 아래 하한 검사가 정상 응답까지 잘린 것으로 몰기 때문이다(최근 1년이면 35 건).
// 두 시장 합쳐 0.5MB 안팎이라 페이지네이션이 필요 없다.
const FROM_DATE = '2000-01-01';
// 코스피 최소 300 · 코스닥 최소 800 은 실측(445 · 1,043)의 3분의 2 수준이다.
// HTTP 200 인데 표가 잘려 온 응답을 정상으로 받아들이지 않기 위한 하한이다.
const MINIMUM_DELISTING_COUNT: Record<'KOSPI' | 'KOSDAQ', number> = {
  KOSPI: 300,
  KOSDAQ: 800,
};

// KIND 는 marketType 으로 시장을 가른다. 6 은 코넥스인데, 유니버스가 코스피·코스닥만 담으므로
// 받지 않는다 — 코넥스를 섞으면 폐지 사유에 '지정자문인 선임계약 해지'(코넥스 전용 제도)가
// 들어와 사유 분포가 실제와 어긋난다.
const ENDPOINTS = [
  { market: 'KOSPI' as const, marketType: '1' },
  { market: 'KOSDAQ' as const, marketType: '2' },
];

@Injectable()
export class KrxDelistingClient {
  async fetchDelistings(): Promise<KrxDelisting[]> {
    const delistings: KrxDelisting[] = [];

    for (const endpoint of ENDPOINTS) {
      const body = new URLSearchParams({
        method: 'searchDelCompanySub',
        currentPageSize: String(PAGE_SIZE),
        pageIndex: '1',
        forward: 'delcompany_down',
        marketType: endpoint.marketType,
        fromDate: FROM_DATE,
        // 서버가 UTC 면 KST 00~09 시 사이에 어제 날짜가 되어 그날 폐지된 종목이 조회에서 빠진다.
        toDate: getTodayKstDate(),
        orderMode: '3',
        orderStat: 'D',
      });
      const response = await fetch(KRX_DELISTING_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // Referer 가 없으면 KIND 가 조회 폼을 거치지 않은 요청으로 보고 빈 표를 준다.
          Referer: `${KRX_DELISTING_URL}?method=searchDelCompanyMain`,
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(
          `KRX ${endpoint.market} 상장폐지 목록 요청 실패: HTTP ${response.status} ${response.statusText}`.trim(),
        );
      }

      const encodedHtml = await response.arrayBuffer();
      // 상장법인 목록과 같은 EUC-KR 응답이다.
      const html = new TextDecoder('euc-kr').decode(encodedHtml);
      const parsed = parseKrxDelistingHtml(html, endpoint.market);
      const minimum = MINIMUM_DELISTING_COUNT[endpoint.market];
      if (parsed.length < minimum) {
        throw new Error(
          `KRX ${endpoint.market} 상장폐지 목록이 ${minimum.toLocaleString()}건 미만입니다: ${parsed.length}건`,
        );
      }
      delistings.push(...parsed);
    }

    return delistings;
  }
}
