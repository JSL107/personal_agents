import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import {
  IMPACT_REPORT_QUEUE,
  ImpactReportJobData,
} from '../domain/webhook.type';

// Webhook 으로 enqueued 된 impact-report 작업을 직렬 처리. concurrency=1 로 동시 LLM 호출 방지.
// retry/backoff 정책은 producer (controller) 측에서 결정 — 여기는 단일 작업 실행만 책임.
@Processor(IMPACT_REPORT_QUEUE, { concurrency: 1 })
export class WebhookImpactReportConsumer extends WorkerHost {
  private readonly logger = new Logger(WebhookImpactReportConsumer.name);

  constructor(
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
  ) {
    super();
  }

  async process(job: Job<ImpactReportJobData>): Promise<void> {
    const { subject, slackUserId } = job.data;
    this.logger.log(`Webhook impact-report 시작 — ${subject}`);
    try {
      await this.generateImpactReportUsecase.execute({ subject, slackUserId });
      this.logger.log(`Webhook impact-report 완료 — ${subject}`);
    } catch (error: unknown) {
      this.logger.error(
        `Webhook impact-report 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
