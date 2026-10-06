import { Inject, Injectable } from '@nestjs/common';

import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
  LatestRunRow,
} from '../../agent-run/domain/port/agent-run.repository.port';
import {
  getKstDayStartAsUtc,
  getTodayKstDate,
} from '../../common/util/kst-date.util';
import { ConsoleActivity, ConsoleRecentRun } from '../domain/activity.type';
import { buildConsoleActivity, groupRecentRuns } from './console-activity';

// 대시보드 그래프가 보여 주는 기간(오늘 포함).
export const ACTIVITY_DAY_COUNT = 14;
// 대시보드 "최근 실행" 목록 길이(묶은 뒤 줄 수).
export const RECENT_RUN_LIMIT = 8;
// 최근 실행을 묶기 위해 원장을 이어 읽는 한 번의 행 수와 최대 횟수. 5분 주기 cron(장중 손절
// 점검)이 장중 내내 연달아 돌면 한 묶음이 수십 행이라, 고정 행 수로 자르면 count 가 모자라고
// 그 앞의 다른 실행이 안 보인다. 8번째 묶음의 경계를 볼 때까지 이어 읽는다.
export const RECENT_RUN_PAGE_SIZE = 50;
// ponytail: 1000행(장중 손절 점검 약 13일치)을 넘으면 마지막 줄 count 는 하한값이 된다.
export const RECENT_RUN_MAX_PAGES = 20;

@Injectable()
export class BuildActivityUsecase {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute(): Promise<ConsoleActivity> {
    const [activityRows, recentRuns] = await Promise.all([
      this.repository.findRunsStartedSince({
        since: getKstDayStartAsUtc(ACTIVITY_DAY_COUNT - 1),
      }),
      this.collectRecentRuns(),
    ]);
    return buildConsoleActivity(activityRows, recentRuns, {
      today: getTodayKstDate(),
      serverTime: new Date().toISOString(),
      dayCount: ACTIVITY_DAY_COUNT,
    });
  }

  private async collectRecentRuns(): Promise<ConsoleRecentRun[]> {
    const rows: LatestRunRow[] = [];
    for (let page = 0; page < RECENT_RUN_MAX_PAGES; page += 1) {
      const last = rows.at(-1);
      const batch = await this.repository.findLatestRuns({
        limit: RECENT_RUN_PAGE_SIZE,
        before:
          last === undefined
            ? undefined
            : { startedAt: last.startedAt, id: last.id },
      });
      rows.push(...batch);
      const grouped = groupRecentRuns(rows, RECENT_RUN_LIMIT);
      if (grouped.complete || batch.length < RECENT_RUN_PAGE_SIZE) {
        return grouped.runs;
      }
    }
    return groupRecentRuns(rows, RECENT_RUN_LIMIT).runs;
  }
}
