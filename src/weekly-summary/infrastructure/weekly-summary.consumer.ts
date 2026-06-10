import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { CeoException } from '../../agent/ceo/domain/ceo.exception';
import { CeoErrorCode } from '../../agent/ceo/domain/ceo-error-code.enum';
import { coerceToDailyPlan } from '../../agent/pm/domain/prompt/previous-plan-formatter';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { CronIdempotencyService } from '../../common/queue/cron-idempotency.service';
import {
  CRON_SENT_GUARD_TTL_SECONDS,
  LONG_RUNNING_WORKER_OPTIONS,
} from '../../common/queue/worker-options.constant';
import { getTodayKstDate } from '../../common/util/kst-date.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  SLACK_NOTIFIER_PORT,
  SlackNotifierPort,
} from '../../morning-briefing/domain/port/slack-notifier.port';
import { formatCeoMetaOutput } from '../../slack/format/ceo-meta.formatter';
import { formatDailyReview } from '../../slack/format/daily-review.formatter';
import { formatModelFooter } from '../../slack/format/model-footer.formatter';
import {
  WEEKLY_SUMMARY_QUEUE,
  WeeklySummaryJobData,
} from '../domain/weekly-summary.type';

// 중복 발송 차단: BullMQ stalled 재처리로 같은 슬롯 2회 처리 시 deliverOnce 가 skip.
// worklog(P4)와 CEO meta(P5)는 별도 발송이므로 keySuffix 로 키를 분리 — 같은 키면 worklog 가
// 잡은 뒤 CEO meta 가 항상 skip 되는 버그가 된다.
@Processor(WEEKLY_SUMMARY_QUEUE, LONG_RUNNING_WORKER_OPTIONS)
export class WeeklySummaryConsumer extends WorkerHost {
  private readonly logger = new Logger(WeeklySummaryConsumer.name);

  constructor(
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly generateCeoMetaUsecase: GenerateCeoMetaUsecase,
    private readonly agentRunService: AgentRunService,
    @Inject(SLACK_NOTIFIER_PORT)
    private readonly slackNotifier: SlackNotifierPort,
    private readonly cronIdempotency: CronIdempotencyService,
  ) {
    super();
  }

  async process(job: Job<WeeklySummaryJobData>): Promise<void> {
    const { ownerSlackUserId, target } = job.data;
    this.logger.log(
      `Weekly Summary 시작 — owner=${ownerSlackUserId} → target=${target}`,
    );

    const runs = await this.agentRunService.findRecentSucceededRuns({
      agentType: AgentType.PM,
      slackUserId: ownerSlackUserId,
      sinceDays: 7,
      limit: 7,
    });

    if (runs.length === 0) {
      await this.deliverOnce(
        target,
        '이번 주 PM AgentRun 기록이 없습니다. Weekly Summary 를 생성하지 않습니다.',
      );
      return;
    }

    const planLines = runs
      .map((run) => {
        const plan = coerceToDailyPlan(run.output);
        if (!plan) {
          return null;
        }
        const allTasks = [plan.topPriority, ...plan.morning, ...plan.afternoon];
        const taskTitles = allTasks.map((t) => `- ${t.title}`).join('\n');
        return `[${run.endedAt.toISOString().slice(0, 10)}]\n${taskTitles}`;
      })
      .filter((line): line is string => line !== null);

    const workText = `이번 주 일일 plan 요약 (자동 생성):\n\n${planLines.join('\n\n')}`;

    const outcome = await this.generateWorklogUsecase.execute({
      workText,
      slackUserId: ownerSlackUserId,
      triggerType: TriggerType.WEEKLY_SUMMARY_CRON,
    });

    const worklogText =
      formatDailyReview(outcome.result) + formatModelFooter(outcome);
    await this.deliverOnce(target, worklogText);

    await this.triggerCeoMetaGracefully({
      slackUserId: ownerSlackUserId,
      target,
    });
  }

  // 발송 idempotency 가드 — stalled 재처리로 같은 날 두 번째 처리가 오면 발송 skip.
  // keySuffix: 한 cron 안 여러 독립 발송(worklog vs ceo-meta)을 구분 — 각자 한 번씩 보장.
  private async deliverOnce(
    target: string,
    text: string,
    keySuffix = '',
  ): Promise<void> {
    const dateKey = getTodayKstDate();
    const scope = keySuffix
      ? `${WEEKLY_SUMMARY_QUEUE}:${keySuffix}`
      : WEEKLY_SUMMARY_QUEUE;
    const firstRun = await this.cronIdempotency.acquireOnce(
      `cron:${scope}:${dateKey}`,
      CRON_SENT_GUARD_TTL_SECONDS,
    );
    if (!firstRun) {
      this.logger.warn(
        `${scope} 중복 발송 차단 — ${dateKey} 이미 발송됨 (stalled 재처리 추정)`,
      );
      return;
    }
    await this.slackNotifier.postMessage({ target, text });
    this.logger.log(`${scope} 발송 완료 — target=${target}`);
  }

  // CEO meta (P5) 는 worklog (P4) 직후 자동 트리거. PO_EVAL run 부재 시 graceful skip.
  // worklog 자체의 성공/실패에 영향을 주지 않는다. 발송은 worklog 와 별도 키(:ceo-meta:)로 가드.
  private async triggerCeoMetaGracefully({
    slackUserId,
    target,
  }: {
    slackUserId: string;
    target: string;
  }): Promise<void> {
    try {
      const ceoOutcome = await this.generateCeoMetaUsecase.execute({
        slackUserId,
        range: 'WEEK',
        triggerType: TriggerType.WEEKLY_CEO_META_CRON,
      });
      const ceoText =
        formatCeoMetaOutput(ceoOutcome.result) + formatModelFooter(ceoOutcome);
      await this.deliverOnce(target, ceoText, 'ceo-meta');
    } catch (error) {
      if (
        error instanceof CeoException &&
        error.ceoErrorCode === CeoErrorCode.NO_PO_EVAL_RUN
      ) {
        this.logger.warn(
          `CEO meta skip — PO_EVAL run 없음 (owner=${slackUserId}): ${error.message}`,
        );
        await this.deliverOnce(
          target,
          '_CEO meta 는 이번 주 PO_EVAL run 부재로 skip 됩니다. `/po-eval` 을 먼저 실행해주세요._',
          'ceo-meta',
        );
        return;
      }
      this.logger.error(
        `CEO meta 실패 — 예상 외 에러 (owner=${slackUserId})`,
        error,
      );
    }
  }
}
