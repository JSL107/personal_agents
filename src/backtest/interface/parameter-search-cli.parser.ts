import { ScreenStrategy } from '../../screener/domain/screener-rule';

export const PARAMETER_SEARCH_CLI_USAGE =
  '사용법:\n' +
  '  pnpm param-search --from YYYY-MM-DD --to YYYY-MM-DD\n' +
  '                    [--strategy SWING,LONG_TERM]\n' +
  '                    [--window-months 6] [--step-months 6]\n' +
  '                    [--take-profit 2,5,10,15,30]\n' +
  '                    [--stop-loss -0.2,-2,-3,-5,-7,-15]\n' +
  '                    [--turnover-min 300000000,500000000]\n' +
  '                    [--weight 15,20,25]\n' +
  '                    [--include-bandless] [--out <경로.json>]\n' +
  '\n' +
  '  값을 주지 않은 축은 그 전략의 활성 행(현행값) 하나로 고정된다.\n' +
  '  축 하나만 훑고 싶으면 그 축에만 목록을 주면 된다.';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const readOption = (argv: string[], key: string): string | undefined => {
  const index = argv.indexOf(`--${key}`);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  // 값 없이 플래그만 오면 다음 플래그가 값으로 먹혀 조용히 엉뚱한 설정으로 돈다.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(
      `--${key} 에 값이 필요합니다.\n${PARAMETER_SEARCH_CLI_USAGE}`,
    );
  }
  return value;
};

const readDate = (argv: string[], key: string): string => {
  const value = readOption(argv, key);
  if (value === undefined) {
    throw new Error(`--${key} 는 필수입니다.\n${PARAMETER_SEARCH_CLI_USAGE}`);
  }
  if (!DATE_PATTERN.test(value)) {
    throw new Error(
      `--${key} 는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${value}\n${PARAMETER_SEARCH_CLI_USAGE}`,
    );
  }
  // 형식만 맞으면 2026-02-30 이 통과하고 new Date 가 3월로 넘긴다.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(
      `--${key} 는 실제 존재하는 날짜여야 합니다. 받은 값: ${value}\n${PARAMETER_SEARCH_CLI_USAGE}`,
    );
  }
  return value;
};

const readNumberList = (
  argv: string[],
  key: string,
  accept: (value: number) => boolean,
  requirement: string,
): number[] | undefined => {
  const raw = readOption(argv, key);
  if (raw === undefined) {
    return undefined;
  }
  // `split(',')` 은 빈 배열을 주지 않는다 — `--take-profit ,,` 같은 오타는 `['','','']` 이
  // 되어 아래 유한성 검사에 걸린다. 그래서 길이 검사를 따로 두지 않는다.
  const values = raw.split(',').map((part) => Number(part.trim()));
  for (const value of values) {
    if (!Number.isFinite(value) || !accept(value)) {
      throw new Error(
        `--${key} 는 ${requirement}. 받은 값: ${raw}\n${PARAMETER_SEARCH_CLI_USAGE}`,
      );
    }
  }
  return values;
};

const readPositiveInteger = (
  argv: string[],
  key: string,
  fallback: number,
): number => {
  const raw = readOption(argv, key);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `--${key} 는 1 이상의 정수여야 합니다. 받은 값: ${raw}\n${PARAMETER_SEARCH_CLI_USAGE}`,
    );
  }
  return value;
};

const readStrategies = (argv: string[]): ScreenStrategy[] => {
  const raw = readOption(argv, 'strategy');
  if (raw === undefined) {
    return ['LONG_TERM', 'SWING'];
  }
  const values = raw.split(',').map((part) => part.trim());
  for (const value of values) {
    if (value !== 'LONG_TERM' && value !== 'SWING') {
      throw new Error(
        `--strategy 는 LONG_TERM 또는 SWING 이어야 합니다. 받은 값: ${value}\n${PARAMETER_SEARCH_CLI_USAGE}`,
      );
    }
  }
  return [...new Set(values)] as ScreenStrategy[];
};

/**
 * 축 목록은 **미지정이면 `undefined`** 로 남는다. 파서가 기본값을 박아 넣으면 미지정과
 * "우연히 현행값과 같은 값을 명시" 가 구분되지 않아, 활성 행이 무엇이든 늘 같은 격자를
 * 돌게 된다. 진입점이 활성 행으로 이 자리를 채운다.
 */
export interface ParameterSearchCliOptions {
  strategies: ScreenStrategy[];
  from: string;
  to: string;
  windowMonths: number;
  stepMonths: number;
  takeProfitPercents?: number[];
  stopLossPercents?: number[];
  minimumTurnover60s?: number[];
  maximumWeightPercents?: number[];
  includeBandless: boolean;
  outPath?: string;
}

export const parseParameterSearchCliArguments = (
  argv: string[],
): ParameterSearchCliOptions => {
  const from = readDate(argv, 'from');
  const to = readDate(argv, 'to');
  if (from > to) {
    throw new Error(
      `--from 이 --to 보다 늦습니다 (${from} > ${to}).\n${PARAMETER_SEARCH_CLI_USAGE}`,
    );
  }
  return {
    strategies: readStrategies(argv),
    from,
    to,
    windowMonths: readPositiveInteger(argv, 'window-months', 6),
    stepMonths: readPositiveInteger(argv, 'step-months', 6),
    takeProfitPercents: readNumberList(
      argv,
      'take-profit',
      (value) => value > 0,
      '0보다 큰 수여야 합니다',
    ),
    stopLossPercents: readNumberList(
      argv,
      'stop-loss',
      (value) => value < 0,
      '0보다 작은 수여야 합니다',
    ),
    minimumTurnover60s: readNumberList(
      argv,
      'turnover-min',
      (value) => value > 0,
      '0보다 큰 수여야 합니다',
    ),
    maximumWeightPercents: readNumberList(
      argv,
      'weight',
      (value) => value > 0 && value <= 100,
      '0 초과 100 이하의 수여야 합니다',
    ),
    includeBandless: argv.includes('--include-bandless'),
    outPath: readOption(argv, 'out'),
  };
};
