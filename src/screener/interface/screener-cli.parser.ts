import { CollectPricesOptions } from '../application/collect-universe-prices.usecase';
import { ScreenUniverseOptions } from '../application/screen-universe.usecase';

export const SCREENER_CLI_USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/screener.ts sync-universe\n' +
  '  pnpm exec ts-node scripts/screener.ts collect-prices [--days <봉수>] [--limit <종목수>]\n' +
  '  pnpm exec ts-node scripts/screener.ts screen [--strategy LONG_TERM|SWING] [--limit <종목수>]';

export interface SyncUniverseArguments {
  subcommand: 'sync-universe';
  options: Record<string, never>;
}

export interface CollectPricesArguments {
  subcommand: 'collect-prices';
  options: CollectPricesOptions;
}

export interface ScreenArguments {
  subcommand: 'screen';
  options: ScreenUniverseOptions;
}

export type ScreenerCliArguments =
  | SyncUniverseArguments
  | CollectPricesArguments
  | ScreenArguments;

const parsePositiveInteger = (value: string, key: string): number => {
  if (!/^\d+$/.test(value) || Number(value) <= 0) {
    throw new Error(`--${key}는 양의 정수여야 합니다.\n${SCREENER_CLI_USAGE}`);
  }
  return Number(value);
};

const parseCollectPricesOptions = (
  optionValues: string[],
): CollectPricesOptions => {
  const options: CollectPricesOptions = {};
  for (let index = 0; index < optionValues.length; index += 2) {
    const key = optionValues[index];
    const value = optionValues[index + 1];
    if (
      (key !== '--days' && key !== '--limit') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(SCREENER_CLI_USAGE);
    }
    const parsed = parsePositiveInteger(value, key.slice(2));
    if (key === '--days') {
      options.days = parsed;
    } else {
      options.limit = parsed;
    }
  }
  return options;
};

const parseScreenOptions = (optionValues: string[]): ScreenUniverseOptions => {
  const options: ScreenUniverseOptions = { strategy: 'LONG_TERM' };
  for (let index = 0; index < optionValues.length; index += 2) {
    const key = optionValues[index];
    const value = optionValues[index + 1];
    if (
      (key !== '--strategy' && key !== '--limit') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(SCREENER_CLI_USAGE);
    }
    if (key === '--strategy') {
      if (value !== 'LONG_TERM' && value !== 'SWING') {
        throw new Error(SCREENER_CLI_USAGE);
      }
      options.strategy = value;
    } else {
      options.limit = parsePositiveInteger(value, 'limit');
    }
  }
  return options;
};

export const parseScreenerCliArguments = (
  values: string[],
): ScreenerCliArguments => {
  const [subcommand, ...optionValues] = values;
  if (subcommand === 'sync-universe') {
    if (optionValues.length > 0) {
      throw new Error(SCREENER_CLI_USAGE);
    }
    return { subcommand, options: {} };
  }
  if (subcommand === 'collect-prices') {
    return {
      subcommand,
      options: parseCollectPricesOptions(optionValues),
    };
  }
  if (subcommand === 'screen') {
    return { subcommand, options: parseScreenOptions(optionValues) };
  }
  throw new Error(SCREENER_CLI_USAGE);
};
