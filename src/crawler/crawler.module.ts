import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { CrawlUsecase } from './application/crawl.usecase';
import { CrawlerConsumer } from './infrastructure/crawler.consumer';
import { CrawlerController } from './interface/crawler.controller';
import { CrawlerProvider } from './interface/crawler.provider';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'crawler-queue',
    }),
  ],
  controllers: [CrawlerController],
  providers: [CrawlerConsumer, CrawlUsecase, CrawlerProvider],
})
export class CrawlerModule {}
