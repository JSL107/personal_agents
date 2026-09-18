import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  SUBCONSCIOUS_TICK_QUEUE,
  SubconsciousTickJobData,
} from '../domain/subconscious-tick.type';

// 아침 브리핑(08:30) 직후 한 번만 돈다. 전에는 20분마다(하루 72회) 돌며 제안 DM 을 즉시
// 보냈고, 그래서 업무 시간 내내 불시에 끼어들었다.
//
// 실측(2026-09-18)이 그 차이를 보여준다. 같은 사람에게 가는 두 종류의 승인 카드인데 결과가
// 갈렸다 — 저녁 회고의 승인 카드는 매일 19시에 몰려 오고 85~100% 눌렸고, 자율 제안은
// 10~17시에 흩어져 와서 72건 중 사람이 무시 버튼을 누른 흔적이 0건이었다(나머지는 만료·스윕
// 자동 종료). 버튼도 DM 도 양쪽 다 있었으므로 남은 차이는 「예측 가능한 시각에 오는가」다.
//
// tick 이 하루 1회가 되면 상태 변화 감지 창도 24시간으로 늘어난다. 그만큼 한 회차에 변화가
// 여러 건 잡히지만, 시간당 상한(SUBCONSCIOUS_PROMOTION_BUDGET_PER_HOUR, 기본 4)이 제안 수를
// 막아 준다. 더 촘촘한 감지가 필요하면 SUBCONSCIOUS_SCHEDULE 로 되돌릴 수 있다.
const DEFAULT_SUBCONSCIOUS_SCHEDULE = '0 9 * * *';
const DEFAULT_SUBCONSCIOUS_TIMEZONE = 'Asia/Seoul';

// 부팅 시 SUBCONSCIOUS_ENABLED='true' + AUTOPILOT_OWNER_SLACK_USER_ID 설정이면
// 20분마다 subconscious:tick:<owner> repeatable job 을 등록한다.
// 미설정/비활성 시 기존 repeatable 정리 후 "비활성" 로그만 남긴다.
@Injectable()
export class SubconsciousScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubconsciousScheduler.name);

  constructor(
    @InjectQueue(SUBCONSCIOUS_TICK_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const enabled = this.configService.get<string>('SUBCONSCIOUS_ENABLED');
    const owner = this.configService.get<string>(
      'AUTOPILOT_OWNER_SLACK_USER_ID',
    );

    if (enabled !== 'true' || !owner || owner.trim().length === 0) {
      this.logger.log(
        'Subconscious 비활성 (SUBCONSCIOUS_ENABLED !== "true" 또는 AUTOPILOT_OWNER_SLACK_USER_ID 미설정).',
      );
      await this.cleanupExistingRepeatables();
      return;
    }

    const ownerTrimmed = owner.trim();
    await this.cleanupExistingRepeatables();

    const schedule = this.readNonEmpty(
      'SUBCONSCIOUS_SCHEDULE',
      DEFAULT_SUBCONSCIOUS_SCHEDULE,
    );

    const payload: SubconsciousTickJobData = {
      ownerSlackUserId: ownerTrimmed,
    };

    await this.queue.add('tick', payload, {
      repeat: { pattern: schedule, tz: DEFAULT_SUBCONSCIOUS_TIMEZONE },
      jobId: `subconscious:tick:${ownerTrimmed}`,
      removeOnComplete: 20,
      removeOnFail: 20,
      attempts: 2,
      backoff: { type: 'exponential', delay: 60_000 },
    });

    this.logger.log(
      `Subconscious 활성화 — owner="${ownerTrimmed}", cron="${schedule}" (${DEFAULT_SUBCONSCIOUS_TIMEZONE})`,
    );
  }

  private readNonEmpty(key: string, fallback: string): string {
    const raw = this.configService.get<string>(key);
    if (!raw) {
      return fallback;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  }

  private async cleanupExistingRepeatables(): Promise<void> {
    const repeatables = await this.queue.getRepeatableJobs();
    for (const job of repeatables) {
      await this.queue.removeRepeatableByKey(job.key);
    }
  }
}
