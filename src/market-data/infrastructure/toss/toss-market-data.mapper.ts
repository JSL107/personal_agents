import { Prisma } from '@prisma/client';

import { DailyBar } from '../../domain/market-data.type';

interface RawCandle {
  timestamp?: unknown;
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

const mapCandle = (raw: unknown): DailyBar | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const candle = raw as RawCandle;
  const {
    timestamp,
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
    return {
      tradeDate,
      close: closePrice,
      adjClose: closePrice,
      volume: BigInt(rawVolume),
      currency,
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
