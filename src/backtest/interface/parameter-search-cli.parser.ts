import {
  RankingWeights,
  ScreenStrategy,
} from '../../screener/domain/screener-rule';
import { BACKTEST_DEFAULTS } from './backtest-cli.parser';

export const PARAMETER_SEARCH_CLI_USAGE =
  '사용법:\n' +
  '  pnpm param-search --from YYYY-MM-DD --to YYYY-MM-DD\n' +
  '                    [--strategy SWING,LONG_TERM]\n' +
  '                    [--window-months 6] [--step-months 6]\n' +
  '                    [--take-profit 2,5,10,15,30]\n' +
  '                    [--stop-loss -0.2,-2,-3,-5,-7,-15]\n' +
  '                    [--turnover-min 300000000,500000000]\n' +
  '                    [--weight 15,20,25]\n' +
  '                    [--volume-surge-min 1.0,1.5,2.0 <SWING 전용>]\n' +
  '                    [--rank-weights 1:1:1,0:1:1,2:1:1]\n' +
  '                    [--slippage 0,0.1,0.3 <체결가를 불리하게 밀 %, 기본 0>]\n' +
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
  // 빈 항목을 숫자로 바꾸기 **전에** 끊는다. `Number('')` 은 0 이라, 0 을 받는 축
  // (`--slippage`)에서는 `--slippage ,,` 가 "0% 회차 세 개" 로 조용히 통과한다. 0 을 안 받는
  // 축들은 아래 `accept` 가 걸러 왔지만, 그것은 축의 값 범위에 기댄 우연이었다.
  const parts = raw.split(',').map((part) => part.trim());
  if (parts.some((part) => part === '')) {
    throw new Error(
      `--${key} 에 빈 항목이 있습니다. 받은 값: ${raw}\n${PARAMETER_SEARCH_CLI_USAGE}`,
    );
  }
  const values = parts.map((part) => Number(part));
  for (const value of values) {
    if (!Number.isFinite(value) || !accept(value)) {
      throw new Error(
        `--${key} 는 ${requirement}. 받은 값: ${raw}\n${PARAMETER_SEARCH_CLI_USAGE}`,
      );
    }
  }
  return values;
};

const readRankingWeightsList = (
  argv: string[],
): RankingWeights[] | undefined => {
  const raw = readOption(argv, 'rank-weights');
  if (raw === undefined) {
    return undefined;
  }
  return raw.split(',').map((part) => {
    const components = part.trim().split(':');
    const values = components.map((component) => Number(component));
    if (
      components.length !== 3 ||
      components.some((component) => component.trim() === '') ||
      values.some((value) => !Number.isFinite(value) || value < 0) ||
      values.reduce((sum, value) => sum + value, 0) <= 0
    ) {
      throw new Error(
        `--rank-weights 는 0 이상 유한수 3개 조합을 콜론으로 구분해야 합니다. 받은 값: ${raw}\n${PARAMETER_SEARCH_CLI_USAGE}`,
      );
    }
    return values as unknown as RankingWeights;
  });
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
  volumeSurgeMinimums?: number[];
  rankingWeights?: RankingWeights[];
  includeBandless: boolean;
  outPath?: string;
  /**
   * 체결가를 몇 % 불리하게 밀지. **격자 축이 아니다** — 값마다 독립된 회차로 돌고,
   * 순위·walk-forward 판정은 회차 안에서만 이뤄진다.
   *
   * 한 격자에 섞으면 순위가 무의미해진다. 창 안의 순위는 조합끼리 초과수익으로 겨루고
   * walk-forward 는 그 1위를 현행값과 견주는데, 슬리피지가 다른 조합이 같은 격자에 있으면
   * **"덜 불리하게 가정한 쪽" 이 늘 이긴다.** 재려는 것은 조합 간 우열이 그 가정에 얼마나
   * 견디는가이므로, 회차를 갈라 놓고 회차끼리 비교해야 한다.
   *
   * 여러 값을 한 번에 주는 것은 창 캐시를 나눠 쓰기 위해서다 — 재생의 대부분이 후보
   * 산출이고 그 계산은 슬리피지와 무관하다.
   */
  slippagePercents: number[];
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
    volumeSurgeMinimums: readNumberList(
      argv,
      'volume-surge-min',
      (value) => value > 0,
      '0보다 큰 수여야 합니다',
    ),
    rankingWeights: readRankingWeightsList(argv),
    includeBandless: argv.includes('--include-bandless'),
    outPath: readOption(argv, 'out'),
    // 백테스트 CLI 와 같은 규칙(0 이상 100 미만)이되 목록을 받는다. 미지정이면 미반영
    // 회차 하나만 돈다 — 옛 회차와 같은 조건이라 기준선이 그대로 재현된다.
    // 중복은 제거한다. 같은 값이 두 번 오면 회차가 둘 생기는데 `planKeyOf` 가 같아 한 버킷에
    // 결과가 합쳐져, 재생만 두 배로 하고 리포트에는 창·재생 수가 부풀려진 표가 나온다.
    slippagePercents: [
      ...new Set(
        readNumberList(
          argv,
          'slippage',
          (value) => value >= 0 && value < 100,
          '0 이상 100 미만의 수여야 합니다',
        ) ?? [BACKTEST_DEFAULTS.slippagePercent],
      ),
    ],
  };
};
