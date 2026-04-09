import { CrawlerProvider } from '../interface/crawler.provider';
import { CrawlUsecase } from './crawl.usecase';

describe('CrawlUsecase', () => {
  let usecase: CrawlUsecase;
  let crawlerProvider: jest.Mocked<CrawlerProvider>;

  beforeEach(() => {
    crawlerProvider = {
      enqueue: jest.fn(),
    } as unknown as jest.Mocked<CrawlerProvider>;

    usecase = new CrawlUsecase(crawlerProvider);
  });

  describe('requestCrawl', () => {
    it('주어진 url로 크롤링 작업을 큐에 등록한다', async () => {
      // Given
      const url = 'https://example.com';
      crawlerProvider.enqueue.mockResolvedValue(undefined);

      // When
      await usecase.requestCrawl({ url });

      // Then
      expect(crawlerProvider.enqueue).toHaveBeenCalledTimes(1);
      expect(crawlerProvider.enqueue).toHaveBeenCalledWith({ url });
    });

    it('큐 등록 실패 시 예외를 전파한다', async () => {
      // Given
      const url = 'https://example.com';
      crawlerProvider.enqueue.mockRejectedValue(new Error('Queue connection failed'));

      // When / Then
      await expect(usecase.requestCrawl({ url })).rejects.toThrow('Queue connection failed');
    });
  });
});
