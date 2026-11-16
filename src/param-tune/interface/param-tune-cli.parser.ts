import { utcMidnightOf } from '../../common/util/kst-date.util';
import {
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../../strategy-parameter/domain/strategy-parameter.type';
import { TUNE_AXIS_ORDER } from '../domain/param-tune.type';

export const PARAM_TUNE_CLI_USAGE =
  '사용법:\n' +
  '  node -r ts-node/register/transpile-only scripts/parameter-tune.ts\n' +
  '       --run-id <n> --attempt-token <t> --strategy LONG_TERM|SWING\n' +
  `       --axis ${TUNE_AXIS_ORDER.join('|')}\n` +
  '       --today YYYY-MM-DD [--agent-run-id <n>]';

export interface ParamTuneCliOptions {
  runId: number;
  attemptToken: string;
  strategy: StrategyParameterStrategy;
  axis: StrategyParameterName;
  today: string;
  agentRunId: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const fail = (message: string): never => {
  throw new Error(`${message}\n${PARAM_TUNE_CLI_USAGE}`);
};

const readOption = (argv: string[], key: string): string | undefined => {
  const index = argv.indexOf(`--${key}`);
  if (index < 0) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    return fail(`--${key} 에 값이 필요합니다.`);
  }
  return value;
};

const readRequired = (argv: string[], key: string): string =>
  readOption(argv, key) ?? fail(`--${key} 는 필수입니다.`);

const readInteger = (raw: string, key: string): number => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    return fail(`--${key} 는 1 이상의 정수여야 합니다. 받은 값: ${raw}`);
  }
  return value;
};

export const parseParamTuneCliArguments = (
  argv: string[],
): ParamTuneCliOptions => {
  const runId = readInteger(readRequired(argv, 'run-id'), 'run-id');
  const attemptToken = readRequired(argv, 'attempt-token');

  const strategy = readRequired(argv, 'strategy');
  if (strategy !== 'LONG_TERM' && strategy !== 'SWING') {
    return fail(
      `--strategy 는 LONG_TERM 또는 SWING 이어야 합니다. 받은 값: ${strategy}`,
    );
  }

  const axis = TUNE_AXIS_ORDER.find(
    (candidate) => candidate === readRequired(argv, 'axis'),
  );
  if (axis === undefined) {
    return fail(`--axis 는 ${TUNE_AXIS_ORDER.join(', ')} 중 하나여야 합니다.`);
  }

  const today = readRequired(argv, 'today');
  // 형식만 맞으면 2026-02-30 이 통과하고 new Date 가 3월로 넘긴다.
  if (
    !DATE_PATTERN.test(today) ||
    utcMidnightOf(today).toISOString().slice(0, 10) !== today
  ) {
    return fail(
      `--today 는 실제 존재하는 YYYY-MM-DD 여야 합니다. 받은 값: ${today}`,
    );
  }

  const rawAgentRunId = readOption(argv, 'agent-run-id');
  return {
    runId,
    attemptToken,
    strategy,
    axis,
    today,
    agentRunId:
      rawAgentRunId === undefined
        ? null
        : readInteger(rawAgentRunId, 'agent-run-id'),
  };
};
