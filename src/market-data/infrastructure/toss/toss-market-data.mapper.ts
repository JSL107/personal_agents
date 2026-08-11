import { Prisma } from '@prisma/client';

import { DailyBar } from '../../domain/market-data.type';

interface RawCandle {
  timestamp?: unknown;
  openPrice?: unknown;
  highPrice?: unknown;
  lowPrice?: unknown;
  closePrice?: unknown;
  volume?: unknown;
  currency?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const parseOptionalDecimal = (value: unknown): Prisma.Decimal | undefined => {
  if (!isNonEmptyString(value)) {
    return undefined;
  }

  try {
    const decimal = new Prisma.Decimal(value);
    if (!decimal.isFinite()) {
      return undefined;
    }
    return decimal;
  } catch {
    return undefined;
  }
};

const mapCandle = (raw: unknown): DailyBar | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const candle = raw as RawCandle;
  const {
    timestamp,
    openPrice: rawOpenPrice,
    highPrice: rawHighPrice,
    lowPrice: rawLowPrice,
    closePrice: rawClosePrice,
    volume: rawVolume,
    currency,
  } = candle;
  if (
    !isNonEmptyString(timestamp) ||
    !isNonEmptyString(rawClosePrice) ||
    !isNonEmptyString(rawVolume) ||
    !isNonEmptyString(currency)
  ) {
    return null;
  }
  if (!/^\d+$/.test(rawVolume)) {
    return null;
  }

  // `new Date('2026-02-30T…')` 는 Invalid 가 아니라 2026-03-02 로 **자동 보정된다**(실측).
  // NaN 만 보면 존재하지 않는 날짜가 다른 날짜로 조용히 바뀐 채 통과해, 오염 응답을 전체
  // 거부한다는 이 매퍼의 정책이 무너지고 잘못된 `tradeDate` 가 `daily_price` 에 적재된다.
  // 그래서 파싱 결과를 다시 문자열로 돌려 원본과 대조한다.
  const tradeDateText = timestamp.slice(0, 10);
  const tradeDate = new Date(`${tradeDateText}T00:00:00.000Z`);
  if (
    Number.isNaN(tradeDate.getTime()) ||
    tradeDate.toISOString().slice(0, 10) !== tradeDateText
  ) {
    return null;
  }

  try {
    const closePrice = new Prisma.Decimal(rawClosePrice);
    if (!closePrice.isFinite()) {
      return null;
    }
    // 토스는 조정·미조정을 한 응답에 함께 주지 않는다. 요청의 `adjusted` 가 어느 계열을
    // 받을지 결정하므로 close 와 adjClose 에 같은 값이 들어간다 — 즉 `adjusted=false` 로
    // 받은 봉의 adjClose 는 조정가가 아니라 미조정 실제 가격이다. adjClose 를 조정가로
    // 신뢰해야 하는 호출자는 `adjusted` 를 생략(기본 true)해야 한다.
    return {
      tradeDate,
      close: closePrice,
      adjClose: closePrice,
      volume: BigInt(rawVolume),
      currency,
      open: parseOptionalDecimal(rawOpenPrice),
      high: parseOptionalDecimal(rawHighPrice),
      low: parseOptionalDecimal(rawLowPrice),
    };
  } catch {
    return null;
  }
};

export const mapTossCandlesResponse = (raw: unknown): DailyBar[] | null => {
  if (
    !isRecord(raw) ||
    !isRecord(raw.result) ||
    !Array.isArray(raw.result.candles)
  ) {
    return null;
  }

  const bars: DailyBar[] = [];
  for (const candle of raw.result.candles) {
    const bar = mapCandle(candle);
    if (!bar) {
      return null;
    }
    bars.push(bar);
  }
  bars.sort(
    (left, right) => left.tradeDate.getTime() - right.tradeDate.getTime(),
  );
  return bars;
};
