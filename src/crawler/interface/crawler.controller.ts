import { Body, Controller, Post, UseGuards } from '@nestjs/common';

import { LoopbackOnlyGuard } from '../../common/guard/loopback-only.guard';
import { CrawlUsecase } from '../application/crawl.usecase';
import { CreateCrawlJobDto } from './dto/create-crawl-job.dto';

// 크롤 접수는 같은 머신에서만 받는다. 임의 주소를 방문시키는 입구라 네트워크 너머로
// 열어 둘 이유가 없다(대상 주소 자체는 crawler.validator 가 따로 검사한다).
@Controller('v1/crawl-jobs')
@UseGuards(LoopbackOnlyGuard)
export class CrawlerController {
  constructor(private readonly crawlUsecase: CrawlUsecase) {}

  @Post()
  async requestCrawl(@Body() body: CreateCrawlJobDto) {
    await this.crawlUsecase.requestCrawl(body);
  }
}
