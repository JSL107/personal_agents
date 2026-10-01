import { Injectable } from '@nestjs/common';

import { InvestorFlowRow } from '../../domain/investor-flow.type';
import {
  NaverInvestorFlowHttpError,
  NaverInvestorFlowParseError,
} from '../../domain/naver-investor-flow.error';

const MINIMUM_REQUEST_INTERVAL_MS = 250;
const PAGE_SIZE = 60;

interface NaverInvestorFlowResponse {
  trendList?: unknown;
}

// 네이버는 거래가 없던 날(거래정지 등)의 수량을 '-' 로 준다. 거래가 없었으니 0 이 사실이다.
// 거부하면 그 한 행 때문에 페이지 전체가 실패해 해당 종목의 백필이 끝나지 않는다.
const NO_TRADE_MARK = '-';

const parseQuantity = (value: unknown, field: string): bigint => {
  if (value === NO_TRADE_MARK) {
    return 0n;
  }
  if (
    typeof value !== 'string' ||
    !/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)$/u.test(value)
  ) {
    throw new NaverInvestorFlowParseError(`${field} 값이 올바르지 않습니다`);
  }
  return BigInt(value.replaceAll(',', ''));
};

const parseTradeDate = (value: unknown): Date => {
  if (typeof value !== 'string' || !/^\d{8}$/u.test(value)) {
    throw new NaverInvestorFlowParseError('bizdate 형식이 올바르지 않습니다');
  }
  const tradeDate = new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`,
  );
  if (
    Number.isNaN(tradeDate.getTime()) ||
    tradeDate.toISOString().slice(0, 10).replaceAll('-', '') !== value
  ) {
    throw new NaverInvestorFlowParseError('bizdate가 실제 날짜가 아닙니다');
  }
  return tradeDate;
};

export const parseNaverInvestorFlowRows = (
  response: unknown,
): InvestorFlowRow[] => {
  const rows = Array.isArray(response)
    ? response
    : (response as NaverInvestorFlowResponse | null)?.trendList;
  if (!Array.isArray(rows)) {
    throw new NaverInvestorFlowParseError('trendList가 배열이 아닙니다');
  }
  return rows.map((row: unknown) => {
    if (typeof row !== 'object' || row === null) {
      throw new NaverInvestorFlowParseError('행 형식이 올바르지 않습니다');
    }
    const item = row as Record<string, unknown>;
    return {
      tradeDate: parseTradeDate(item.bizdate),
      foreignNetBuy: parseQuantity(
        item.foreignerPureBuyQuant,
        'foreignerPureBuyQuant',
      ),
      institutionNetBuy: parseQuantity(
        item.organPureBuyQuant,
        'organPureBuyQuant',
      ),
      flowVolume: parseQuantity(
        item.accumulatedTradingVolume,
        'accumulatedTradingVolume',
      ),
    };
  });
};

// 네이버 `bizdate` 는 그날을 빼고 그 전 거래일부터 준다(2026-09-30 실측: 20230103 → 첫 행
// 20230102, 20260930 → 20260929). 그대로 넘기면 백필은 페이지 경계마다 하루씩 빠지고(가장
// 오래된 날의 전날로 이어 받으므로), 일일 수집은 당일 행을 못 받는다. 둘 다 20봉 지표를
// 통째로 null 로 만드므로 호출부가 아니라 여기서 한 번 하루를 민다.
export const exclusiveBizdateOf = (throughDate: string): string => {
  const next = new Date(`${throughDate}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10).replaceAll('-', '');
};

@Injectable()
export class NaverInvestorFlowClient {
  private lastRequestAt: number | null = null;

  // `throughDate`(YYYY-MM-DD) 당일을 포함해 그 이전 거래일을 최신순으로 돌려준다.
  async fetchRows(
    code: string,
    throughDate: string,
  ): Promise<InvestorFlowRow[]> {
    await this.waitForRequestInterval();
    const query = new URLSearchParams({
      pageSize: String(PAGE_SIZE),
      bizdate: exclusiveBizdateOf(throughDate),
    });
    const response = await fetch(
      `https://m.stock.naver.com/api/stock/${encodeURIComponent(code)}/trend?${query.toString()}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok) {
      throw new NaverInvestorFlowHttpError(response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new NaverInvestorFlowParseError(message);
    }
    return parseNaverInvestorFlowRows(body);
  }

  private async waitForRequestInterval(): Promise<void> {
    const elapsed =
      this.lastRequestAt === null
        ? MINIMUM_REQUEST_INTERVAL_MS
        : Date.now() - this.lastRequestAt;
    const waitMs = MINIMUM_REQUEST_INTERVAL_MS - elapsed;
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestAt = Date.now();
  }
}
