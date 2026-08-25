import { BackfillPricesOptions } from '../application/backfill-universe-prices.usecase';
import { CollectBenchmarkOptions } from '../application/collect-benchmark-closes.usecase';
import { CollectPricesOptions } from '../application/collect-universe-prices.usecase';
import { ScreenUniverseOptions } from '../application/screen-universe.usecase';

export const SCREENER_CLI_USAGE =
  '사용법:\n' +
  '  pnpm exec ts-node scripts/screener.ts sync-universe\n' +
  '  pnpm exec ts-node scripts/screener.ts collect-prices [--days <봉수>] [--limit <종목수>]\n' +
  '  pnpm exec ts-node scripts/screener.ts backfill-prices [--years <연수>] [--limit <종목수>]\n' +
  '  pnpm exec ts-node scripts/screener.ts collect-benchmark [--days <봉수>]\n' +
  '  pnpm exec ts-node scripts/screener.ts screen [--strategy LONG_TERM|SWING] [--limit <종목수>] [--record]\n' +
  '  pnpm exec ts-node scripts/screener.ts score-outcomes';

export interface SyncUniverseArguments {
  subcommand: 'sync-universe';
  options: Record<string, never>;
}

export interface CollectPricesArguments {
  subcommand: 'collect-prices';
  options: CollectPricesOptions;
}

export interface BackfillPricesArguments {
  subcommand: 'backfill-prices';
  options: BackfillPricesOptions;
}

export interface ScreenArguments {
  subcommand: 'screen';
  options: ScreenUniverseOptions;
}

export interface CollectBenchmarkArguments {
  subcommand: 'collect-benchmark';
  options: CollectBenchmarkOptions;
}

// 회차에 실린 종목의 사후 성적을 매긴다. 재는 지평도 대상도 원장이 정하므로 옵션이 없다.
export interface ScoreOutcomesArguments {
  subcommand: 'score-outcomes';
  options: Record<string, never>;
}

export type ScreenerCliArguments =
  | SyncUniverseArguments
  | CollectPricesArguments
  | BackfillPricesArguments
  | CollectBenchmarkArguments
  | ScreenArguments
  | ScoreOutcomesArguments;

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

const parseBackfillPricesOptions = (
  optionValues: string[],
): BackfillPricesOptions => {
  const options: BackfillPricesOptions = {};
  for (let index = 0; index < optionValues.length; index += 2) {
    const key = optionValues[index];
    const value = optionValues[index + 1];
    if (
      (key !== '--years' && key !== '--limit') ||
      value === undefined ||
      value.startsWith('--')
    ) {
      throw new Error(SCREENER_CLI_USAGE);
    }
    const parsed = parsePositiveInteger(value, key.slice(2));
    if (key === '--years') {
      options.years = parsed;
    } else {
      options.limit = parsed;
    }
  }
  return options;
};

const parseScreenOptions = (optionValues: string[]): ScreenUniverseOptions => {
  const options: ScreenUniverseOptions = { strategy: 'LONG_TERM' };
  let index = 0;
  while (index < optionValues.length) {
    const key = optionValues[index];
    // --record 는 값을 받지 않는 플래그라 다음 토큰을 건너뛰지 않는다.
    // CLI 실행은 추천 실행이 아니므로 agentRunId 가 없다 — 그래서 같은 기준일의
    // 운영 회차를 덮어쓰지 못하고 건너뛴다(저장 쪽에서 막는다).
    if (key === '--record') {
      options.record = { agentRunId: null };
      index += 1;
      continue;
    }
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
    index += 2;
  }
  return options;
};

const parseCollectBenchmarkOptions = (
  optionValues: string[],
): CollectBenchmarkOptions => {
  const options: CollectBenchmarkOptions = {};
  for (let index = 0; index < optionValues.length; index += 2) {
    const key = optionValues[index];
    const value = optionValues[index + 1];
    if (key !== '--days' || value === undefined || value.startsWith('--')) {
      throw new Error(SCREENER_CLI_USAGE);
    }
    options.days = parsePositiveInteger(value, 'days');
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
  if (subcommand === 'backfill-prices') {
    return {
      subcommand,
      options: parseBackfillPricesOptions(optionValues),
    };
  }
  if (subcommand === 'collect-benchmark') {
    return {
      subcommand,
      options: parseCollectBenchmarkOptions(optionValues),
    };
  }
  if (subcommand === 'screen') {
    return { subcommand, options: parseScreenOptions(optionValues) };
  }
  if (subcommand === 'score-outcomes') {
    if (optionValues.length > 0) {
      throw new Error(SCREENER_CLI_USAGE);
    }
    return { subcommand, options: {} };
  }
  throw new Error(SCREENER_CLI_USAGE);
};
