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

interface AxisValue {
  axis: StrategyParameterName;
  value: number;
}

interface AxisChange {
  axis: StrategyParameterName;
  from: number | null;
  to: number | null;
}

const formatValue = ({ axis, value }: AxisValue): string => {
  if (axis === 'MINIMUM_TURNOVER60') {
    return formatTurnoverLabel(value);
  }
  return String(value);
};

const formatChange = ({ axis, from, to }: AxisChange): string => {
  if (from === null || to === null) {
    return '';
  }
  const fromText = formatValue({ axis, value: from });
  const toText = formatValue({ axis, value: to });
  return ` ${fromText}→${toText}`;
};

// 평가 상세는 { decision: RollbackDecision, ... } 모양이고 판정 불가일 때만 reason 이 있다.
const inconclusiveSuffix = (detail: unknown): string => {
  const reason = (detail as { decision?: { reason?: unknown } } | null)
    ?.decision?.reason;
  if (typeof reason !== 'string') {
    return '';
  }
  return ` (${escapeMrkdwn(reason)})`;
};

/** 평가가 확정된 행은 평가를 다시 알리는 것이다 — 예전 결정을 다시 찍으면 또 반영한 것으로 읽힌다. */
const describeEvaluation = (row: TuneRunRow): string | null => {
  // 롤백은 적용했던 값(candidate)을 직전 값(previous)으로 되돌리는 것이다.
  const applied = formatChange({
    axis: row.axis,
    from: row.previousValue,
    to: row.candidateValue,
  });
  const reverted = formatChange({
    axis: row.axis,
    from: row.candidateValue,
    to: row.previousValue,
  });
  switch (row.evaluation) {
    case 'ROLLBACK':
      return `되돌림${reverted} ${ROLLBACK_BASIS}`;
    case 'ROLLBACK_SKIPPED':
      return '되돌리려 했으나 값이 이미 바뀌어 건너뜀';
    case 'KEEP':
      return `시험 통과, 유지${applied}`;
    case 'INCONCLUSIVE':
      return `판정할 수 없어 유지${inconclusiveSuffix(row.evaluationDetail)}`;
    case 'WOULD_KEEP':
      return '[관찰] 가상 시험 결과: 유지했을 것';
    case 'WOULD_ROLLBACK':
      return '[관찰] 가상 시험 결과: 되돌렸을 것';
    case null:
      return null;
  }
};

const describeDecision = (row: TuneRunRow): string => {
  const change = formatChange({
    axis: row.axis,
    from: row.previousValue,
    to: row.candidateValue,
  });
  switch (row.decision) {
    case 'APPLIED':
      return `반영${change}`;
    case 'WOULD_APPLY':
      return `[관찰] 반영했을 값${change}`;
    case 'NO_CHANGE':
      return `변화 없음 (${firstLine(row.decisionReason)})`;
    case null:
      // off·롤백한 주처럼 탐색 자체를 건너뛴 회차.
      return `탐색 안 함 (${firstLine(row.decisionReason)})`;
  }
};

const describe = (row: TuneRunRow): string => {
  if (row.status === 'FAILED') {
    return `실패 (${firstLine(row.failureReason)})`;
  }
  if (row.status === 'SKIPPED_PROBATION') {
    return '시험 중인 값이 있어 이번 주는 건너뜀';
  }
  return describeEvaluation(row) ?? describeDecision(row);
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
