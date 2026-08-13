import { Prisma } from '@prisma/client';

import type { BenchmarkBar } from '../../domain/port/market-indicator.port';

interface RawMarketIndicatorCandle {
  timestamp?: unknown;
  closePrice?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const mapCandle = (raw: unknown): BenchmarkBar | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const candle = raw as RawMarketIndicatorCandle;
  if (
    !isNonEmptyString(candle.timestamp) ||
    !isNonEmptyString(candle.closePrice)
  ) {
    return null;
  }

  // `new Date('2026-02-30T…')` 는 2026-03-02 로 조용히 보정되므로, 변환한 날짜를
  // 원문과 다시 대조해 존재하지 않는 거래일이 저장되는 것을 막는다.
  const tradeDateText = candle.timestamp.slice(0, 10);
  const tradeDate = new Date(`${tradeDateText}T00:00:00.000Z`);
  if (
    Number.isNaN(tradeDate.getTime()) ||
    tradeDate.toISOString().slice(0, 10) !== tradeDateText
  ) {
    return null;
  }

  try {
    const close = new Prisma.Decimal(candle.closePrice);
    if (!close.isFinite()) {
      return null;
    }
    return { tradeDate, close };
  } catch {
    return null;
  }
};

export const mapTossMarketIndicatorResponse = (
  raw: unknown,
): BenchmarkBar[] | null => {
  if (
    !isRecord(raw) ||
    !isRecord(raw.result) ||
    !Array.isArray(raw.result.candles)
  ) {
    return null;
  }

  const bars: BenchmarkBar[] = [];
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
