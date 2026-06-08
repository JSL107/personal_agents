import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { LONG_RUNNING_WORKER_OPTIONS } from '../../common/queue/worker-options.constant';
import { ProcessCrawlJobUsecase } from '../application/process-crawl-job.usecase';
import { CrawlSuccessResult, CrawlTarget } from '../domain/crawler.type';
import {
  logCrawlError,
  resolveCrawlError,
  toQueueError,
} from './crawl-error.util';

@Processor('crawler-queue', { concurrency: 3, ...LONG_RUNNING_WORKER_OPTIONS })
export class CrawlerConsumer extends WorkerHost {
  private readonly logger = new Logger(CrawlerConsumer.name);

  constructor(private readonly processCrawlJobUsecase: ProcessCrawlJobUsecase) {
    super();
  }

  async process(job: Job<CrawlTarget>): Promise<CrawlSuccessResult> {
    return this.consume(job);
  }

  private async consume(job: Job<CrawlTarget>): Promise<CrawlSuccessResult> {
    const { url } = job.data;
    this.logger.log(`크롤링 작업 시도: ${url}`);

    try {
      const result = await this.processCrawlJobUsecase.execute({ url });
      this.logger.log(`크롤링 완료: ${url}`);
      return result;
    } catch (error: unknown) {
      const crawlError = resolveCrawlError({ error, url });
      logCrawlError({ logger: this.logger, url, error: crawlError });
      throw toQueueError({ error: crawlError });
    }
  }
}
