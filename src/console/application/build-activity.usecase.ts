import { Inject, Injectable } from '@nestjs/common';

import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
} from '../../agent-run/domain/port/agent-run.repository.port';
import {
  getKstDayStartAsUtc,
  getTodayKstDate,
} from '../../common/util/kst-date.util';
import { ConsoleActivity } from '../domain/activity.type';
import { buildConsoleActivity } from './console-activity';

// 대시보드 그래프가 보여 주는 기간(오늘 포함).
export const ACTIVITY_DAY_COUNT = 14;
// 대시보드 "최근 실행" 목록 길이(묶은 뒤 줄 수).
export const RECENT_RUN_LIMIT = 8;
// 묶기 전에 읽는 원장 행 수. 5분 주기 cron(장중 손절 점검)이 하루 60회 넘게 돌아, 8건만
// 읽으면 목록이 그 한 가지로 채워졌다(2026-10-06 실측 8건 중 7건).
export const RECENT_RUN_SCAN = 50;

@Injectable()
export class BuildActivityUsecase {
  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
  ) {}

  async execute(): Promise<ConsoleActivity> {
    const [activityRows, latestRows] = await Promise.all([
      this.repository.findRunsStartedSince({
        since: getKstDayStartAsUtc(ACTIVITY_DAY_COUNT - 1),
      }),
      this.repository.findLatestRuns({ limit: RECENT_RUN_SCAN }),
    ]);
    return buildConsoleActivity(activityRows, latestRows, {
      today: getTodayKstDate(),
      serverTime: new Date().toISOString(),
      dayCount: ACTIVITY_DAY_COUNT,
      recentLimit: RECENT_RUN_LIMIT,
    });
  }
}
