import { buildSearchWindows } from '../../backtest/domain/parameter-search';
import { mondayOf } from '../../common/util/kst-date.util';
import { StrategyParameterName } from '../../strategy-parameter/domain/strategy-parameter.type';
import {
  TUNE_AXIS_ORDER,
  TUNE_ROTATION_ANCHOR,
  TUNE_SEARCH_FROM,
  TUNE_WINDOW_MONTHS,
} from './param-tune.type';

const MS_PER_DAY = 86_400_000;

const toUtcMs = (dateText: string): number => {
  const [year, month, day] = dateText.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};

/** 그 날짜가 속한 주의 월요일 (YYYY-MM-DD). */
export const weekStartOf = (dateText: string): string => mondayOf(dateText);

/** 기준 주로부터 지난 주 수 mod 축 개수. 기준 이전 주도 음수 없이 돈다. */
export const axisForWeek = (weekStart: string): StrategyParameterName => {
  const weeks = Math.round(
    (toUtcMs(weekStart) - toUtcMs(TUNE_ROTATION_ANCHOR)) / (7 * MS_PER_DAY),
  );
  const size = TUNE_AXIS_ORDER.length;
  return TUNE_AXIS_ORDER[((weeks % size) + size) % size];
};

/** 끝이 today 보다 앞선 창 중 마지막 창의 끝. today 에 끝나거나 잘린 창은 아직 완결이 아니다. */
export const lastCompletedWindowEnd = (today: string): string => {
  const completed = buildSearchWindows({
    from: TUNE_SEARCH_FROM,
    to: today,
    windowMonths: TUNE_WINDOW_MONTHS,
    stepMonths: TUNE_WINDOW_MONTHS,
  }).filter((window) => window.to < today);
  if (completed.length === 0) {
    throw new Error(`완결된 탐색 창이 없습니다 (today=${today}).`);
  }
  return completed[completed.length - 1].to;
};
