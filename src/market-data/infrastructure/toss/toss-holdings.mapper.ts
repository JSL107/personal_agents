import { Prisma } from '@prisma/client';

import { BrokerHolding } from '../../domain/broker-holdings.type';

interface RawHolding {
  symbol?: unknown;
  name?: unknown;
  marketCountry?: unknown;
  currency?: unknown;
  quantity?: unknown;
  averagePurchasePrice?: unknown;
  lastPrice?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const mapHolding = (raw: unknown): BrokerHolding | null => {
  if (!isRecord(raw)) {
    return null;
  }

  const holding = raw as RawHolding;
  const requiredValues = [
    holding.symbol,
    holding.name,
    holding.marketCountry,
    holding.currency,
    holding.quantity,
    holding.averagePurchasePrice,
    holding.lastPrice,
  ];
  if (!requiredValues.every(isNonEmptyString)) {
    return null;
  }

  try {
    const quantity = new Prisma.Decimal(holding.quantity as string);
    const averagePurchasePrice = new Prisma.Decimal(
      holding.averagePurchasePrice as string,
    );
    const lastPrice = new Prisma.Decimal(holding.lastPrice as string);
    if (
      !quantity.isFinite() ||
      !averagePurchasePrice.isFinite() ||
      !lastPrice.isFinite()
    ) {
      return null;
    }
    return {
      symbol: holding.symbol as string,
      name: holding.name as string,
      marketCountry: holding.marketCountry as string,
      currency: holding.currency as string,
      quantity,
      averagePurchasePrice,
      lastPrice,
    };
  } catch {
    return null;
  }
};

export const mapTossHoldingsResponse = (
  raw: unknown,
): BrokerHolding[] | null => {
  if (!isRecord(raw) || !isRecord(raw.result)) {
    return null;
  }
  const { items } = raw.result;
  if (!Array.isArray(items)) {
    return null;
  }

  const holdings: BrokerHolding[] = [];
  for (const item of items) {
    const holding = mapHolding(item);
    if (!holding) {
      return null;
    }
    holdings.push(holding);
  }
  return holdings;
};
