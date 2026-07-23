import { Prisma } from '@prisma/client';

import {
  DailyBar,
  MarketCode,
  ResolvedInstrument,
} from '../domain/market-data.type';

// 라이브러리 응답은 런타임에 형식이 바뀔 수 있어 unknown 으로 받고 여기서만 좁힌다.
interface RawQuote {
  shortName?: string;
  regularMarketPrice?: number;
  currency?: string;
  fullExchangeName?: string;
}

interface RawChartQuote {
  date?: Date;
  close?: number;
  adjclose?: number;
  volume?: number;
}

const SUFFIX_TO_MARKET: Record<string, MarketCode> = {
  '.KS': 'KOSPI',
  '.KQ': 'KOSDAQ',
};

const resolveUnitedStatesMarket = (
  currency: string,
  fullExchangeName?: string,
): MarketCode | null => {
  if (currency !== 'USD' || !fullExchangeName) {
    return null;
  }
  if (fullExchangeName.startsWith('Nasdaq')) {
    return 'NASDAQ';
  }
  if (fullExchangeName.startsWith('NYSE')) {
    return 'NYSE';
  }
  return null;
};

// 잘못된 접미사에 대해 Yahoo 는 예외 대신 shortName 이 "심볼,ID,ID" 형태이거나
// 심볼 문자열 자체인 응답을 준다. 이 두 가지가 오염의 신호다.
const isPollutedName = (name: string, yahooSymbol: string): boolean => {
  if (name === yahooSymbol) {
    return true;
  }
  return name.includes(',');
};

export const mapQuoteToInstrument = (
  raw: unknown,
  yahooSymbol: string,
): ResolvedInstrument | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const { shortName, regularMarketPrice, currency, fullExchangeName } =
    raw as RawQuote;
  if (!shortName || regularMarketPrice == null || !currency) {
    return null;
  }
  if (isPollutedName(shortName, yahooSymbol)) {
    return null;
  }

  const isUnitedStatesSymbol = !yahooSymbol.includes('.');
  const suffix = yahooSymbol.slice(-3);
  const market = isUnitedStatesSymbol
    ? resolveUnitedStatesMarket(currency, fullExchangeName)
    : SUFFIX_TO_MARKET[suffix];
  if (!market) {
    return null;
  }

  return {
    yahooSymbol,
    code: isUnitedStatesSymbol ? yahooSymbol : yahooSymbol.slice(0, -3),
    market,
    name: shortName,
    currency,
  };
};

export const mapChartQuoteToDailyBar = (
  raw: unknown,
  currency: string,
): DailyBar | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const chartQuote = raw as RawChartQuote;
  if (!chartQuote.date || chartQuote.close == null) {
    return null;
  }
  const adjClose = chartQuote.adjclose ?? chartQuote.close;
  return {
    tradeDate: chartQuote.date,
    close: new Prisma.Decimal(chartQuote.close),
    adjClose: new Prisma.Decimal(adjClose),
    volume: BigInt(Math.trunc(chartQuote.volume ?? 0)),
    currency,
  };
};
