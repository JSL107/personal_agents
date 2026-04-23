import { createHash } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { CrawlTarget } from '../domain/crawler.type';
import {
  CRAWL_QUEUE_PORT,
  CrawlQueuePort,
} from '../domain/port/crawl-queue.port';

export { CRAWL_QUEUE_PORT };

@Injectable()
export class CrawlerProvider implements CrawlQueuePort {
  constructor(
    @InjectQueue('crawler-queue') private readonly crawlerQueue: Queue,
  ) {}

  async enqueue({ url }: CrawlTarget): Promise<void> {
    const jobId = createHash('md5').update(url).digest('hex');

    await this.crawlerQueue.add(
      'crawl',
      { url },
      {
        jobId,
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    );
  }
}
