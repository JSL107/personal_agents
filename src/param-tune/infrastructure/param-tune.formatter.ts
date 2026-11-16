import { formatTurnoverLabel } from '../../backtest/domain/parameter-search';
import {
  StrategyParameterName,
  StrategyParameterStrategy,
} from '../../strategy-parameter/domain/strategy-parameter.type';
import { TuneRunRow } from '../domain/port/param-tune-run.port';

const STRATEGY_LABEL: Record<StrategyParameterStrategy, string> = {
  SWING: '스윙',
  LONG_TERM: '장기',
};

const AXIS_LABEL: Record<StrategyParameterName, string> = {
  EXIT_TAKE_PROFIT_PERCENT: '익절 %',
  EXIT_STOP_LOSS_PERCENT: '손절 %',
  MINIMUM_TURNOVER60: '최소 거래대금',
  MAXIMUM_WEIGHT_PERCENT: '최대 비중 %',
};

const ROLLBACK_BASIS = '(재생 모형 비교 기준)';

// 사유는 모델·자식 프로세스 로그에서 온 문자열이라 Slack mrkdwn 제어 문자를 막는다.
const escapeMrkdwn = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

const firstLine = (text: string | null): string =>
  escapeMrkdwn((text ?? '').split('\n')[0].trim() || '사유 미상');

const formatValue = (axis: StrategyParameterName, value: number): string =>
  axis === 'MINIMUM_TURNOVER60' ? formatTurnoverLabel(value) : String(value);

const formatChange = (
  axis: StrategyParameterName,
  from: number | null,
  to: number | null,
): string =>
  from === null || to === null
    ? ''
    : ` ${formatValue(axis, from)}→${formatValue(axis, to)}`;

const describe = (row: TuneRunRow): string => {
  if (row.status === 'FAILED') {
    return `실패(${firstLine(row.failureReason)})`;
  }
  if (row.status === 'SKIPPED_PROBATION') {
    return 'SKIPPED_PROBATION';
  }
  // 롤백은 적용했던 값(candidate)을 직전 값(previous)으로 되돌리는 것이다.
  if (row.evaluation === 'ROLLBACK') {
    return `ROLLBACK${formatChange(row.axis, row.candidateValue, row.previousValue)} ${ROLLBACK_BASIS}`;
  }
  if (row.evaluation === 'ROLLBACK_SKIPPED') {
    return `ROLLBACK_SKIPPED ${ROLLBACK_BASIS}`;
  }
  if (row.decision === 'NO_CHANGE') {
    return `NO_CHANGE(${firstLine(row.decisionReason)})`;
  }
  if (row.decision === 'APPLIED' || row.decision === 'WOULD_APPLY') {
    return `${row.decision}${formatChange(row.axis, row.previousValue, row.candidateValue)}`;
  }
  return row.status;
};

const dateText = (date: Date): string => date.toISOString().slice(0, 10);

export const formatParamTuneReport = (rows: TuneRunRow[]): string => {
  const latestWeek = rows
    .map((row) => dateText(row.weekStart))
    .sort()
    .at(-1);
  const lines = rows.map((row) => {
    const week = dateText(row.weekStart);
    const weekPrefix = week === latestWeek ? '' : `[${week} 주] `;
    return `• ${weekPrefix}${STRATEGY_LABEL[row.strategy]} · ${AXIS_LABEL[row.axis]} · ${describe(row)}`;
  });
  return [`*투자 파라미터 자동 조정* (${latestWeek} 주)`, ...lines].join('\n');
};
