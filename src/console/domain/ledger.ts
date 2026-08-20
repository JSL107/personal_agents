import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { LedgerRunRow } from '../../agent-run/domain/port/agent-run.repository.port';
import { formatKstDate } from '../../common/util/kst-date.util';
import { classifyAutonomy } from './agent-autonomy';
import { ConsoleAgentLedger, ConsoleLedger, LedgerClock } from './ledger.type';
import { isStalled } from './stall';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

interface DatedLedgerRunRow extends LedgerRunRow {
  readonly kstDate: string;
}

interface WeekBounds {
  readonly thisWeekStart: string;
  readonly lastWeekStart: string;
  readonly lastWeekEnd: string;
}

const addCalendarDays = (date: string, days: number): string => {
  const timestamp = new Date(`${date}T00:00:00Z`).getTime();
  return new Date(timestamp + days * DAY_IN_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
};

const differenceInCalendarDays = (later: string, earlier: string): number => {
  const laterTimestamp = new Date(`${later}T00:00:00Z`).getTime();
  const earlierTimestamp = new Date(`${earlier}T00:00:00Z`).getTime();
  return (laterTimestamp - earlierTimestamp) / DAY_IN_MILLISECONDS;
};

const getWeekBounds = (today: string): WeekBounds => {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  const thisWeekStart = addCalendarDays(today, -daysSinceMonday);
  const lastWeekStart = addCalendarDays(thisWeekStart, -7);

  // 지난주 전체와 비교하면 진행 중인 이번 주가 항상 하락처럼 보인다. 실측도 179 대 278
  // (35% 폭락)에서 같은 요일까지 자르자 182 대 187로 바뀌어, 비교 기간을 맞춰야 했다.
  return {
    thisWeekStart,
    lastWeekStart,
    lastWeekEnd: addCalendarDays(lastWeekStart, daysSinceMonday),
  };
};

const attachKstDate = (row: LedgerRunRow): DatedLedgerRunRow => {
  const kstDate = formatKstDate(row.startedAt.toISOString());
  if (kstDate === null) {
    throw new Error('AgentRun startedAt을 KST 날짜로 변환할 수 없습니다.');
  }
  return { ...row, kstDate };
};

const buildAgentLedger = (
  agentType: string,
  rows: readonly DatedLedgerRunRow[],
  today: string,
): ConsoleAgentLedger => {
  if (rows.length === 0) {
    return {
      agentType,
      firstRunDate: null,
      totalRuns: 0,
      failedRuns: 0,
      lastRunAt: null,
      autonomy: 'NEVER_RUN',
      stalled: false,
      idleDays: null,
    };
  }

  const firstRunDate = rows.reduce(
    (earliest, row) => (row.kstDate < earliest ? row.kstDate : earliest),
    rows[0].kstDate,
  );
  const lastRun = rows.reduce((latest, row) =>
    row.startedAt.getTime() > latest.startedAt.getTime() ? row : latest,
  );
  const autonomy = classifyAutonomy(rows.map((row) => row.triggerType));
  const activeDays = new Set(rows.map((row) => row.kstDate)).size;
  const ageDays = differenceInCalendarDays(today, firstRunDate);
  const idleDays = differenceInCalendarDays(today, lastRun.kstDate);

  return {
    agentType,
    firstRunDate,
    totalRuns: rows.length,
    failedRuns: rows.filter((row) => row.status === 'FAILED').length,
    lastRunAt: lastRun.startedAt.toISOString(),
    autonomy,
    stalled: isStalled({ autonomy, activeDays, ageDays, idleDays }),
    idleDays,
  };
};

export const buildConsoleLedger = (
  rows: readonly LedgerRunRow[],
  clock: LedgerClock,
): ConsoleLedger => {
  const datedRows = rows.map(attachKstDate);
  const rowsByAgentType = new Map<string, DatedLedgerRunRow[]>();
  for (const row of datedRows) {
    const agentRows = rowsByAgentType.get(row.agentType) ?? [];
    agentRows.push(row);
    rowsByAgentType.set(row.agentType, agentRows);
  }

  const agentTypes = new Set<string>(
    AGENT_REGISTRY.map((entry) => entry.agentType),
  );
  for (const agentType of rowsByAgentType.keys()) {
    agentTypes.add(agentType);
  }

  const agents = [...agentTypes]
    .map((agentType) =>
      buildAgentLedger(
        agentType,
        rowsByAgentType.get(agentType) ?? [],
        clock.today,
      ),
    )
    .sort((left, right) => {
      if (left.totalRuns !== right.totalRuns) {
        return right.totalRuns - left.totalRuns;
      }
      if (left.agentType === right.agentType) {
        return 0;
      }
      return left.agentType < right.agentType ? -1 : 1;
    });

  const foundedDate = datedRows.reduce<string | null>(
    (earliest, row) =>
      earliest === null || row.kstDate < earliest ? row.kstDate : earliest,
    null,
  );
  const weekBounds = getWeekBounds(clock.today);

  return {
    agents,
    company: {
      foundedDate,
      ageDays:
        foundedDate === null
          ? 0
          : differenceInCalendarDays(clock.today, foundedDate) + 1,
      totalRuns: datedRows.length,
      failedRuns: datedRows.filter((row) => row.status === 'FAILED').length,
      thisWeekRuns: datedRows.filter(
        (row) =>
          row.kstDate >= weekBounds.thisWeekStart && row.kstDate <= clock.today,
      ).length,
      lastWeekRunsToSameWeekday: datedRows.filter(
        (row) =>
          row.kstDate >= weekBounds.lastWeekStart &&
          row.kstDate <= weekBounds.lastWeekEnd,
      ).length,
    },
    serverTime: clock.serverTime,
  };
};
