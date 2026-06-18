import { Inject, Injectable, Logger } from '@nestjs/common';

import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import { CRON_SENT_GUARD_TTL_SECONDS } from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { AUTOPILOT_TASKS, AutopilotTask } from '../domain/autopilot-task.port';
import { PlaybookEntry } from '../domain/playbook.type';

// 플레이북 그룹을 실행 → 비-skip slackText 수집 → 구분자로 합쳐 멱등 1회 후 다중 타깃 fan-out 발송.
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

  async runGroup(
    groupKey: string,
    entries: PlaybookEntry[],
    ownerSlackUserId: string,
    target: string,
  ): Promise<void> {
    const firedAtKst = getTodayKstDate();
    const parts: string[] = [];

    for (const entry of entries) {
      if (entry.riskTier !== 'T0_AUTO') {
        throw new Error(
          `Autopilot: T1_PREVIEW 전달은 SP4 — 미지원 (entry=${entry.id})`,
        );
      }
      const task = this.tasks.get(entry.taskId);
      if (!task) {
        throw new Error(`Autopilot: task 미등록 — taskId=${entry.taskId}`);
      }
      // 한 task 의 런타임 실패(모델 응답 파싱 실패 / LLM hang 등 외부 변동)가 그룹 전체를
      // 죽여 cron job 을 throw 시키지 않도록 격리한다. (이전엔 work-reviewer 의 JSON 파싱
      // 실패가 evening 그룹 전체를 실패시켜 daily-eval 보고까지 누락 + cron 실패 알람 발사.)
      // 설정 오류(riskTier/미등록)는 위에서 여전히 fail-fast — 운영 변동만 격리한다.
      try {
        const result = await task.run({ ownerSlackUserId, firedAtKst });
        if (!result.skip && result.slackText) {
          parts.push(result.slackText);
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Autopilot[${groupKey}] task '${entry.taskId}' 실패 (그룹은 계속): ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        // 조용한 실패 방지 — owner digest 에 짧게 표기. message 는 길이 cap.
        parts.push(
          `_⚠️ ${entry.taskId} 자동 생성 실패 — ${message.slice(0, 200)}. 다음 슬롯에 재시도됩니다._`,
        );
      }
    }

    if (parts.length === 0) {
      this.logger.log(`Autopilot[${groupKey}] — 보고 내용 없음, 전달 skip`);
      return;
    }

    const firstRun = await this.cronIdempotency.acquireOnce(
      `autopilot:${groupKey}:${firedAtKst}`,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `Autopilot[${groupKey}] — ${firedAtKst} 이미 발송됨, 중복 차단`,
      );
      return;
    }

    const text = parts.join('\n\n────────\n\n');
    const targets = target
      .split(',')
      .map((resolved) => resolved.trim())
      .filter((resolved) => resolved.length > 0);

    for (const resolved of targets) {
      await this.slackNotifier.postMessage({ target: resolved, text });
    }
    this.logger.log(
      `Autopilot[${groupKey}] — 발송 완료 ${targets.length}건 (${entries.length} task)`,
    );
  }
}
