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
    await validateCrawlUrl({ url });

    const { html, finalUrl, responseStatus } =
      await this.crawlerRequester.request({ url });
    // 리다이렉트가 우리를 어디로 데려갔는지 다시 본다 — 바깥 주소로 시작해 내부로 튕기는
    // 경로는 접수 시점 검사만으로는 잡히지 않는다. 도착지가 내부면 본문을 파싱하지 않는다.
    if (finalUrl !== url) {
      await validateCrawlUrl({ url: finalUrl });
    }
    validateCrawlResponse({ responseStatus, url });

    const parsedData = this.crawlerParser.parse(html, finalUrl);

    return { url, status: 'SUCCESS', data: parsedData };
  }
}
