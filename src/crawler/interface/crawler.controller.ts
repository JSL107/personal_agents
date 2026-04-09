import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { CrawlUsecase } from '../application/crawl.usecase';
import { CreateCrawlJobDto } from './dto/create-crawl-job.dto';

@Controller('v1/crawl-jobs')
export class CrawlerController {
  constructor(private readonly crawlUsecase: CrawlUsecase) {}

  @Post()
  @HttpCode(201)
  async requestCrawl(@Body() body: CreateCrawlJobDto) {
    await this.crawlUsecase.requestCrawl(body);
  }
}
