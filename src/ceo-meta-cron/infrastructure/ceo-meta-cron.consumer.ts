import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';

import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { CeoException } from '../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { NotificationPublisher } from '../../notification/application/notification-publisher.service';
import { formatCeoMetaOutput } from '../../slack/format/ceo-meta.formatter';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
import {
  CEO_META_CRON_QUEUE,
  CeoMetaCronJobData,
} from '../domain/ceo-meta-cron.type';

// 주 1회 자동 /ceo-review — Daily Eval consumer 패턴 그대로.
// CEO worker 는 PO_EVAL run 누적 (range=WEEK / TODAY) 을 메타 회고로 합성.
// PO_EVAL run 0개면 NO_POEVAL_RUNS — graceful skip + Slack 안내.
@Processor(CEO_META_CRON_QUEUE)
export class CeoMetaCronConsumer extends WorkerHost {
  private readonly logger = new Logger(CeoMetaCronConsumer.name);

  constructor(
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    @Optional()
    private readonly notificationPublisher?: NotificationPublisher,
  ) {
    super();
  }

  async process(job: Job<CeoMetaCronJobData>): Promise<void> {
    const { ownerSlackUserId, target, range } = job.data;
    this.logger.log(
      `CEO Meta Cron 시작 — owner=${ownerSlackUserId} → target=${target}, range=${range}`,
    );

    const todayKst = getTodayKstDate();
    const rangeLabel = range === 'WEEK' ? '최근 7일' : '최근 24시간';

    try {
      const outcome = await this.generateCeoMetaUsecase.execute({
        slackUserId: ownerSlackUserId,
        range,
        triggerType: TriggerType.WEEKLY_CEO_META_CRON,
      });
      const intro = `🧭 *CEO Meta — ${todayKst} (${rangeLabel} 자동 회고)*\n\n`;
      const text =
        intro + formatCeoMetaOutput(outcome.result) + formatModelFooter(outcome);
      await this.slackNotifier.postMessage({ target, text });
      this.logger.log(`CEO Meta Cron 발송 완료 — target=${target}`);
    } catch (error) {
      if (
        error instanceof CeoException &&
        error.ceoErrorCode === CeoErrorCode.NO_PO_EVAL_RUN
      ) {
        this.logger.warn(
          `CEO Meta Cron skip — PO_EVAL run 없음 (owner=${ownerSlackUserId}): ${error.message}`,
        );
        await this.slackNotifier.postMessage({
          target,
          text: `🌙 *CEO Meta — ${todayKst} skip*\n_${rangeLabel} 안 PO_EVAL run 부재로 메타 회고 대상 없음. 다음 주기에 다시 시도합니다._`,
        });
        return;
      }
      this.logger.error(
        `CEO Meta Cron 실패 — 예상 외 에러 (owner=${ownerSlackUserId})`,
        error,
      );
      this.notifyOwnerFailure(ownerSlackUserId, error);
      throw error;
    }
  }

  // fire-and-forget — NotificationQueue 로 enqueue. consumer 측 30분 dedupe + Slack DM.
  private notifyOwnerFailure(ownerSlackUserId: string, error: unknown): void {
    if (!this.notificationPublisher) {
      return;
    }
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    this.notificationPublisher.publishCronFailure({
      cronName: 'CEO Meta Cron',
      ownerSlackUserId,
      errorMessage,
    });
  }
}
