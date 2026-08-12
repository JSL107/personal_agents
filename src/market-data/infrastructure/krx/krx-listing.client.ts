import { Injectable } from '@nestjs/common';

import { KrxListing, parseKrxListingHtml } from './krx-listing.mapper';

const KRX_LISTING_URL =
  'https://kind.krx.co.kr/corpgeneral/corpList.do?method=download';
const REQUEST_TIMEOUT_MS = 30_000;
// 정상 약 2,595건의 77%도 못 받으면 HTTP 200이어도 잘린 응답으로 간주한다.
const MINIMUM_LISTING_COUNT = 2_000;

const ENDPOINTS = [
  { market: 'KOSPI' as const, marketType: 'stockMkt' },
  { market: 'KOSDAQ' as const, marketType: 'kosdaqMkt' },
];

@Injectable()
export class KrxListingClient {
  async fetchListings(): Promise<KrxListing[]> {
    const listings: KrxListing[] = [];

    for (const endpoint of ENDPOINTS) {
      const response = await fetch(
        `${KRX_LISTING_URL}&marketType=${endpoint.marketType}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!response.ok) {
        throw new Error(
          `KRX ${endpoint.market} 상장법인 목록 요청 실패: HTTP ${response.status} ${response.statusText}`.trim(),
        );
      }

      const encodedHtml = await response.arrayBuffer();
      const html = new TextDecoder('euc-kr').decode(encodedHtml);
      listings.push(...parseKrxListingHtml(html, endpoint.market));
    }

    if (listings.length < MINIMUM_LISTING_COUNT) {
      throw new Error(
        `KRX 상장법인 목록이 ${MINIMUM_LISTING_COUNT.toLocaleString()}건 미만입니다: ${listings.length}건`,
      );
    }

    return listings;
  }
}
