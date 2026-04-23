import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

import { CrawlUsecase } from './application/crawl.usecase';
import { ProcessCrawlJobUsecase } from './application/process-crawl-job.usecase';
import { CRAWL_QUEUE_PORT } from './domain/port/crawl-queue.port';
import { CRAWLER_PARSER_PORT } from './domain/port/crawler-parser.port';
import { CRAWLER_REQUESTER_PORT } from './domain/port/crawler-requester.port';
import { CrawlerConsumer } from './infrastructure/crawler.consumer';
import { CrawlerParser } from './infrastructure/crawler.parser';
import { CrawlerRequester } from './infrastructure/crawler.requester';
import { CrawlerController } from './interface/crawler.controller';
import { CrawlerProvider } from './interface/crawler.provider';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'crawler-queue',
    }),
  ],
  controllers: [CrawlerController],
  providers: [
    CrawlerConsumer,
    ProcessCrawlJobUsecase,
    CrawlUsecase,
    {
      provide: CRAWLER_PARSER_PORT,
      useClass: CrawlerParser,
    },
    {
      provide: CRAWLER_REQUESTER_PORT,
      useClass: CrawlerRequester,
    },
    CrawlerProvider,
    {
      provide: CRAWL_QUEUE_PORT,
      useExisting: CrawlerProvider,
    },
  ],
})
export class CrawlerModule {}
