import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import puppeteer, { Browser } from 'puppeteer';

import { CrawlResult, CrawlTarget } from '../domain/crawler.type';
import { crawlerParser } from './crawler.parser';

@Processor('crawler-queue', { concurrency: 3 })
export class CrawlerConsumer extends WorkerHost {
  private readonly logger = new Logger(CrawlerConsumer.name);

  async process(job: Job<CrawlTarget>): Promise<CrawlResult> {
    return this.crawl(job);
  }

  private async crawl(job: Job<CrawlTarget>): Promise<CrawlResult> {
    const { url } = job.data;
    this.logger.log(`크롤링 작업 시도: ${url}`);

    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const html = await page.content();

      const parsedData = crawlerParser(html, url);
      this.logger.log(`크롤링 완료: ${url}`);

      return { url, status: 'SUCCESS', data: parsedData };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`크롤링 실패: ${url}`, stack);

      return { url, status: 'FAILED', error: message };
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}
