import { ExitBandThreshold } from '../../paper-trading/domain/exit-band';
import { ReplayBacktestCommand } from '../application/replay-backtest.usecase';

export const BACKTEST_CLI_USAGE =
  '사용법:\n' +
  '  pnpm backtest --strategy LONG_TERM|SWING --from YYYY-MM-DD --to YYYY-MM-DD\n' +
  '                [--seed <금액>] [--turnover-min <거래대금>] [--max-positions <종목수>]\n' +
  '                [--weight <비중퍼센트>] [--hold <보유거래일수>]\n' +
  '                [--take-profit <익절%> --stop-loss <손절%>]\n' +
  '                [--delisting-recovery <폐지청산 회수율, 기본 1>]';

// 그림자 성적(shadow-performance)과 같은 값을 쓴다. 기준이 같아야 두 숫자를 나란히 놓을 수 있다.
const DEFAULT_HOLDING_TRADE_DAYS = { LONG_TERM: 60, SWING: 5 } as const;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const readOption = (argv: string[], key: string): string | undefined => {
  const index = argv.indexOf(`--${key}`);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  // 값 없이 플래그만 오면 다음 플래그가 값으로 먹혀 조용히 엉뚱한 설정으로 돈다.
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${key} 에 값이 필요합니다.\n${BACKTEST_CLI_USAGE}`);
  }
  return value;
};

const readOptionalPositiveNumber = (
  argv: string[],
  key: string,
): number | undefined => {
  const raw = readOption(argv, key);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `--${key} 는 0보다 큰 수여야 합니다. 받은 값: ${raw}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  return value;
};

const readPositiveNumber = (
  argv: string[],
  key: string,
  fallback: number,
): number => readOptionalPositiveNumber(argv, key) ?? fallback;

const readDate = (argv: string[], key: string): string => {
  const value = readOption(argv, key);
  if (value === undefined) {
    throw new Error(`--${key} 는 필수입니다.\n${BACKTEST_CLI_USAGE}`);
  }
  if (!DATE_PATTERN.test(value)) {
    throw new Error(
      `--${key} 는 YYYY-MM-DD 형식이어야 합니다. 받은 값: ${value}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  // 형식만 맞으면 2026-02-30 처럼 없는 날짜가 통과하고, new Date 가 3월로 조용히 넘긴다.
  // 출력에는 입력한 날짜가 남고 조회 구간만 밀려 의도하지 않은 기간의 성적이 나온다.
  // 실전 체결의 parseTradeDate 와 같은 방식으로 왕복 대조한다.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(
      `--${key} 는 실제 존재하는 날짜여야 합니다. 받은 값: ${value}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  return value;
};

const readExitBand = (argv: string[]): ExitBandThreshold | null => {
  const takeProfitRaw = readOption(argv, 'take-profit');
  const stopLossRaw = readOption(argv, 'stop-loss');
  if (takeProfitRaw === undefined && stopLossRaw === undefined) {
    return null;
  }
  if (takeProfitRaw === undefined || stopLossRaw === undefined) {
    throw new Error(
      `--take-profit 과 --stop-loss 는 함께 지정해야 합니다.\n${BACKTEST_CLI_USAGE}`,
    );
  }
  const takeProfitPercent = Number(takeProfitRaw);
  if (!Number.isFinite(takeProfitPercent) || takeProfitPercent <= 0) {
    throw new Error(
      `--take-profit 는 0보다 큰 수여야 합니다. 받은 값: ${takeProfitRaw}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  const stopLossPercent = Number(stopLossRaw);
  if (!Number.isFinite(stopLossPercent) || stopLossPercent >= 0) {
    throw new Error(
      `--stop-loss 는 0보다 작은 수여야 합니다. 받은 값: ${stopLossRaw}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  return { takeProfitPercent, stopLossPercent };
};

// 보유 중 폐지된 종목의 청산가를 마지막 종가의 몇 배로 칠지. 상한 1 을 두는 것은 폐지가
// 마지막 종가보다 이득인 경우를 가정하면 그 자체가 낙관 편향이 되기 때문이다.
const readDelistingRecoveryRate = (argv: string[]): number => {
  const raw = readOption(argv, 'delisting-recovery');
  if (raw === undefined) {
    return 1;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(
      `--delisting-recovery 는 0 초과 1 이하의 수여야 합니다. 받은 값: ${raw}\n${BACKTEST_CLI_USAGE}`,
    );
  }
  return value;
};

/**
 * 파싱 결과. 파라미터 테이블이 다루는 두 값은 **미지정이면 `undefined`** 로 남는다.
 *
 * 파서가 기본값을 박아 넣으면 "미지정" 과 "우연히 기본값과 같은 값을 명시" 가 구분되지
 * 않아, 활성 행이 인자를 이기는지 지는지가 값에 따라 달라진다. 진입점이 이 자리를
 * `CLI ?? 활성 행 ?? 코드 상수` 로 채운다.
 *
 * `exitBand` 는 여기 해당하지 않는다 — 백테스트에서 `null` 은 "미지정" 이 아니라
 * "밴드 없이 보유일수로만 청산" 이라는 대조군 스위치다.
 */
export interface BacktestCliOptions extends Omit<
  ReplayBacktestCommand,
  'minimumTurnover60' | 'weightPercent'
> {
  minimumTurnover60?: number;
  weightPercent?: number;
}

export const parseBacktestCliArguments = (
  argv: string[],
): BacktestCliOptions => {
  const strategy = readOption(argv, 'strategy');
  if (strategy !== 'LONG_TERM' && strategy !== 'SWING') {
    throw new Error(
      `--strategy 는 LONG_TERM 또는 SWING 이어야 합니다.\n${BACKTEST_CLI_USAGE}`,
    );
  }
  const seedAmount = readOption(argv, 'seed') ?? '10000000';
  if (!/^\d+$/u.test(seedAmount)) {
    throw new Error(
      `--seed 는 양의 정수여야 합니다. 받은 값: ${seedAmount}\n${BACKTEST_CLI_USAGE}`,
    );
  }

  return {
    strategy,
    from: readDate(argv, 'from'),
    to: readDate(argv, 'to'),
    seedAmount,
    minimumTurnover60: readOptionalPositiveNumber(argv, 'turnover-min'),
    maximumPositions: readPositiveNumber(argv, 'max-positions', 3),
    weightPercent: readOptionalPositiveNumber(argv, 'weight'),
    holdingTradeDays: readPositiveNumber(
      argv,
      'hold',
      DEFAULT_HOLDING_TRADE_DAYS[strategy],
    ),
    exitBand: readExitBand(argv),
    delistingRecoveryRate: readDelistingRecoveryRate(argv),
  };
};
