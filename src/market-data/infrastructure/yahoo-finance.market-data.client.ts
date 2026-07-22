import { Injectable, Logger } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';

import { DailyBar, ResolvedInstrument } from '../domain/market-data.type';
import { MarketDataPort } from '../domain/port/market-data.port';
import {
  mapChartQuoteToDailyBar,
  mapQuoteToInstrument,
} from './yahoo-finance.mapper';

// 일봉 조회 시 달력일 기준으로 여유를 둔다(주말·휴장일에는 봉이 없으므로).
const CALENDAR_DAY_MULTIPLIER = 2;
const CALENDAR_DAY_PADDING = 10;

@Injectable()
export class YahooFinanceMarketDataClient implements MarketDataPort {
  private readonly logger = new Logger(YahooFinanceMarketDataClient.name);
  // v3 부터 정적 호출은 "Call `new YahooFinance()` first" 로 실패한다. 1회 생성해 공유한다.
  private readonly client = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
  });

  async resolveSymbol(yahooSymbol: string): Promise<ResolvedInstrument | null> {
    try {
      const quote = await this.client.quote(yahooSymbol);
      return mapQuoteToInstrument(quote, yahooSymbol);
    } catch (error) {
      this.logger.warn(
        `심볼 조회 실패 — ${yahooSymbol}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  async fetchDailyBars(yahooSymbol: string, days: number): Promise<DailyBar[]> {
    const period1 = new Date();
    period1.setDate(
      period1.getDate() -
        (days * CALENDAR_DAY_MULTIPLIER + CALENDAR_DAY_PADDING),
    );

    const chart = await this.client.chart(yahooSymbol, {
      period1,
      interval: '1d',
    });
    const currency = chart.meta?.currency ?? 'KRW';
    const bars = chart.quotes
      .map((quote) => mapChartQuoteToDailyBar(quote, currency))
      .filter((bar): bar is DailyBar => bar !== null);

    return bars.slice(-days);
  }
}
