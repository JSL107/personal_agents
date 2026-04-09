import { Injectable } from '@nestjs/common';

import { CrawlTarget } from '../domain/crawler.type';
import { CrawlerProvider } from '../interface/crawler.provider';

@Injectable()
export class CrawlUsecase {
  constructor(private readonly crawlerProvider: CrawlerProvider) {}

  async requestCrawl({ url }: CrawlTarget): Promise<void> {
    await this.crawlerProvider.enqueue({ url });
  }
}
