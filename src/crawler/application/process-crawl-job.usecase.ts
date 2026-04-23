import { Inject, Injectable } from '@nestjs/common';

import { CrawlSuccessResult, CrawlTarget } from '../domain/crawler.type';
import {
  validateCrawlResponse,
  validateCrawlUrl,
} from '../domain/crawler.validator';
import {
  CRAWLER_PARSER_PORT,
  CrawlerParserPort,
} from '../domain/port/crawler-parser.port';
import {
  CRAWLER_REQUESTER_PORT,
  CrawlerRequesterPort,
} from '../domain/port/crawler-requester.port';

@Injectable()
export class ProcessCrawlJobUsecase {
  constructor(
    @Inject(CRAWLER_REQUESTER_PORT)
    private readonly crawlerRequester: CrawlerRequesterPort,
    @Inject(CRAWLER_PARSER_PORT)
    private readonly crawlerParser: CrawlerParserPort,
  ) {}

  async execute({ url }: CrawlTarget): Promise<CrawlSuccessResult> {
    validateCrawlUrl({ url });

    const { html, finalUrl, responseStatus } =
      await this.crawlerRequester.request({ url });
    validateCrawlResponse({ responseStatus, url });

    const parsedData = this.crawlerParser.parse(html, finalUrl);

    return { url, status: 'SUCCESS', data: parsedData };
  }
}
