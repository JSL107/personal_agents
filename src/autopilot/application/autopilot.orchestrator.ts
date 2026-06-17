import { Inject, Injectable, Logger } from '@nestjs/common';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { CRON_SENT_GUARD_TTL_SECONDS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import {
  AUTOPILOT_TASKS,
  AutopilotTask,
  AutopilotTaskResult,
} from '../domain/autopilot-task.port';
import { PlaybookEntry } from '../domain/playbook.type';

// 플레이북 항목 1건을 실행 → idle skip → 리스크 티어 전달.
// today(KST)를 1회 계산해 멱등 키 + task 표시에 공유한다(이중 계산 방지).
// 멱등 가드는 "전달 직전"에 둔다 — task 실행이 실패하면 BullMQ 재시도(attempts)가 살아있도록.
@Injectable()
export class AutopilotOrchestrator {
  private readonly logger = new Logger(AutopilotOrchestrator.name);
  private readonly tasks: Map<string, AutopilotTask>;

  constructor(
    @Inject(AUTOPILOT_TASKS) tasks: AutopilotTask[],
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
  ) {
    this.tasks = new Map(tasks.map((task) => [task.id, task]));
  }

  async run(
    entry: PlaybookEntry,
    ownerSlackUserId: string,
    target: string,
  ): Promise<void> {
    const firedAtKst = getTodayKstDate();
    const task = this.tasks.get(entry.taskId);
    if (!task) {
      throw new Error(`Autopilot: task 미등록 — taskId=${entry.taskId}`);
    }
    const result = await task.run({ ownerSlackUserId, firedAtKst });
    if (result.skip) {
      this.logger.log(`Autopilot[${entry.id}] — 보고 내용 없음, 전달 skip`);
      return;
    }
    await this.deliver(entry, target, firedAtKst, result);
  }

  private async deliver(
    entry: PlaybookEntry,
    target: string,
    firedAtKst: string,
    result: AutopilotTaskResult,
  ): Promise<void> {
    if (entry.riskTier !== 'T0_AUTO') {
      throw new Error(
        `Autopilot: T1_PREVIEW 전달은 SP4 에서 구현 — 현재 미지원 (entry=${entry.id})`,
      );
    }
    if (!result.slackText) {
      return;
    }
    const firstRun = await this.cronIdempotency.acquireOnce(
      `autopilot:${entry.id}:${firedAtKst}`,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Autopilot[${entry.id}] — ${firedAtKst} 이미 발송됨, 중복 차단`,
      );
      return;
    }
    await this.slackNotifier.postMessage({ target, text: result.slackText });
    this.logger.log(`Autopilot[${entry.id}] — 발송 완료 target=${target}`);
  }
}
