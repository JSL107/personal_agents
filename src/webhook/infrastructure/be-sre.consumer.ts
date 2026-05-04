import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { AnalyzeStackTraceUsecase } from '../../agent/be-sre/application/analyze-stack-trace.usecase';
import { BeSreException } from '../../agent/be-sre/domain/be-sre.exception';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { BE_SRE_QUEUE, BeSreJobData } from '../domain/webhook.type';

// GitHub check_run.completed (conclusion: failure) webhook 으로 enqueued 된 BE-SRE 작업을 직렬 처리.
// concurrency=1 로 LLM 동시 호출 방지 — impact-report consumer 와 동일 패턴.
@Processor(BE_SRE_QUEUE, { concurrency: 1 })
export class WebhookBeSreConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookBeSreConsumer.name);

  constructor(
    private readonly analyzeStackTraceUsecase: AnalyzeStackTraceUsecase,
  ) {
    super();
  }

  async process(job: Job<BeSreJobData>): Promise<void> {
    const { stackTrace, slackUserId } = job.data;
    this.logger.log(`Webhook BE-SRE 시작 — ${stackTrace.slice(0, 80)}`);
    try {
      await this.analyzeStackTraceUsecase.execute({
        stackTrace,
        slackUserId,
        triggerType: TriggerType.WEBHOOK,
      });
      this.logger.log(`Webhook BE-SRE 완료`);
    } catch (error: unknown) {
      // codex P2 — 도메인 BAD_REQUEST (EMPTY_STACK_TRACE / NO_TS_FRAMES_FOUND 등) 는 영구 실패라
      // 재시도가 무의미. swallow 해서 BullMQ 가 attempts 2회를 소비하지 않도록 한다.
      if (
        error instanceof BeSreException &&
        error.status === DomainStatus.BAD_REQUEST
      ) {
        this.logger.warn(
          `Webhook BE-SRE skip — ${error.beSreErrorCode}: ${error.message}`,
        );
        return;
      }
      this.logger.error(
        `Webhook BE-SRE 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
