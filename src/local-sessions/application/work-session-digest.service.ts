import { homedir } from 'node:os';
import { join } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WorkSessionDigest } from '../domain/work-session-digest';
import { readWorkSessionDigests } from '../infrastructure/work-session-transcript.reader';

export interface WorkSessionDigestConfig {
  claudeProjectsDir: string;
  codexSessionsDir: string;
}

export const WORK_SESSION_DIGEST_CONFIG = Symbol('WORK_SESSION_DIGEST_CONFIG');

export const defaultWorkSessionDigestConfig = (): WorkSessionDigestConfig => ({
  claudeProjectsDir: join(homedir(), '.claude', 'projects'),
  codexSessionsDir: join(homedir(), '.codex', 'sessions'),
});

export const kstStartOfDay = (now: Date): Date => {
  const koreanTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return new Date(
    Date.UTC(
      koreanTime.getUTCFullYear(),
      koreanTime.getUTCMonth(),
      koreanTime.getUTCDate(),
    ) -
      9 * 60 * 60 * 1000,
  );
};

// ponytail: 공휴일은 계산하지 않는다. 필요해지면 HOLIDAY_CALENDAR_PORT로 평일 판정을 교체한다.
export const previousWeekdayMorningKst = (now: Date): Date => {
  const start = kstStartOfDay(now);
  const day = new Date(start.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
  const daysAgo = day === 1 ? 3 : day === 0 ? 2 : day === 6 ? 1 : 1;
  return new Date(
    start.getTime() - daysAgo * 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000,
  );
};

export interface ListWorkSessionsParams {
  readonly since: Date;
  readonly slackUserId: string;
}

@Injectable()
export class WorkSessionDigestService {
  private readonly logger = new Logger(WorkSessionDigestService.name);

  constructor(
    @Inject(WORK_SESSION_DIGEST_CONFIG)
    private readonly config: WorkSessionDigestConfig,
    private readonly configService: ConfigService,
  ) {}

  // 세션 기록은 이 머신 소유자의 것이다. /today·/worklog 는 호출자 제한이 없어서, 다른 사람이
  // 부른 회차에 실으면 회사 코드 대화가 그 사람 계획에 섞인다. 소유자가 설정되지 않았으면
  // 누구의 것인지 판정할 수 없으므로 읽지 않는다.
  listSince({
    since,
    slackUserId,
  }: ListWorkSessionsParams): WorkSessionDigest[] {
    const owner = this.configService
      .get<string>('AUTOPILOT_OWNER_SLACK_USER_ID')
      ?.trim();
    if (!owner || owner !== slackUserId) {
      return [];
    }
    try {
      return readWorkSessionDigests({ ...this.config, since });
    } catch (error: unknown) {
      this.logger.warn(
        `작업 세션 조회 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
