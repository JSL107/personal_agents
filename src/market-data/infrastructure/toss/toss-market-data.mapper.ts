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

  const tradeDate = new Date(`${timestamp.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(tradeDate.getTime())) {
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
