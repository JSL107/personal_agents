import { AgentRunStatus } from '../../agent-run/domain/agent-run.type';
import {
  ActivityRunRow,
  LatestRunRow,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { formatKstDate } from '../../common/util/kst-date.util';
import {
  ConsoleActivity,
  ConsoleActivityDay,
  ConsoleRecentRun,
} from '../domain/activity.type';
import { isAutonomousTrigger } from '../domain/agent-autonomy';
import { activityBubble } from './agent-activity-bubble';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

const addCalendarDays = (date: string, days: number): string =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_IN_MILLISECONDS)
    .toISOString()
    .slice(0, 10);

// 말풍선 문구는 진행형("아침 계획 짜는 중", "#536 리뷰 중")이다. 끝난 실행 목록에는
// 명사형이 맞아 "중" 을 떼고, 동사 관형형 "~는" 은 "~기" 로 바꾼다("짜는 중" → "짜기").
export const toTaskTitle = (bubble: string): string => {
  const withoutProgress = bubble.replace(/\s*중$/, '');
  return withoutProgress.endsWith('는')
    ? `${withoutProgress.slice(0, -1)}기`
    : withoutProgress;
};

const titleOf = (row: LatestRunRow): string => {
  const bubble = activityBubble(row);
  if (bubble !== null) {
    return toTaskTitle(bubble);
  }
  return isAutonomousTrigger(row.triggerType) ? '자동 실행' : '직접 지시';
};

export const buildConsoleActivity = (
  activityRows: readonly ActivityRunRow[],
  latestRows: readonly LatestRunRow[],
  clock: {
    today: string;
    serverTime: string;
    dayCount: number;
    recentLimit: number;
  },
): ConsoleActivity => {
  const firstDay = addCalendarDays(clock.today, -(clock.dayCount - 1));
  const days = new Map<string, ConsoleActivityDay>();
  for (let offset = 0; offset < clock.dayCount; offset += 1) {
    const date = addCalendarDays(firstDay, offset);
    days.set(date, { date, succeeded: 0, failed: 0, other: 0 });
  }

  for (const row of activityRows) {
    const date = formatKstDate(row.startedAt.toISOString());
    const day = date === null ? undefined : days.get(date);
    if (day === undefined) {
      continue;
    }
    days.set(day.date, {
      ...day,
      succeeded:
        day.succeeded + (row.status === AgentRunStatus.SUCCEEDED ? 1 : 0),
      failed: day.failed + (row.status === AgentRunStatus.FAILED ? 1 : 0),
      other:
        day.other +
        (row.status === AgentRunStatus.SUCCEEDED ||
        row.status === AgentRunStatus.FAILED
          ? 0
          : 1),
    });
  }

  // 최신순으로 훑으며 바로 앞 줄과 담당자·일·결과가 같으면 그 줄의 count 만 올린다.
  // 연달아 돈 것만 묶는다 — 사이에 다른 일이 끼면 시간 순서를 지키려 따로 둔다.
  const recentRuns: ConsoleRecentRun[] = [];
  for (const row of latestRows) {
    const title = titleOf(row);
    const previous = recentRuns.at(-1);
    if (
      previous !== undefined &&
      previous.agentType === row.agentType &&
      previous.title === title &&
      previous.status === row.status
    ) {
      recentRuns[recentRuns.length - 1] = {
        ...previous,
        count: previous.count + 1,
      };
      continue;
    }
    if (recentRuns.length === clock.recentLimit) {
      break;
    }
    recentRuns.push({
      id: String(row.id),
      agentType: row.agentType,
      status: row.status,
      title,
      startedAt: row.startedAt.toISOString(),
      finishedAt: row.endedAt === null ? null : row.endedAt.toISOString(),
      count: 1,
    });
  }

  return {
    days: [...days.values()],
    recentRuns,
    serverTime: clock.serverTime,
  };
};
