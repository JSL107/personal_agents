import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';

import { CrawlTarget } from '../domain/crawler.type';

@Injectable()
export class CrawlerProvider {
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
