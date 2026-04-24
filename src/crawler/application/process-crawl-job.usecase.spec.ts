import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ParsedPage } from '../domain/crawler.type';
import { CrawlerParserPort } from '../domain/port/crawler-parser.port';
import { CrawlerRequesterPort } from '../domain/port/crawler-requester.port';
import { ProcessCrawlJobUsecase } from './process-crawl-job.usecase';

describe('ProcessCrawlJobUsecase', () => {
  let usecase: ProcessCrawlJobUsecase;
  let crawlerRequester: jest.Mocked<CrawlerRequesterPort>;
  let crawlerParser: jest.Mocked<CrawlerParserPort>;

  beforeEach(() => {
    crawlerRequester = {
      request: jest.fn(),
    };
    crawlerParser = {
      parse: jest.fn(),
    };

    usecase = new ProcessCrawlJobUsecase(crawlerRequester, crawlerParser);
  });

  it('요청 페이지를 파싱해 성공 결과를 반환한다', async () => {
    const parsedPage: ParsedPage = {
      title: 'Example',
      description: 'Example description',
    };

    crawlerRequester.request.mockResolvedValue({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com/final',
      html: '<html></html>',
      responseStatus: 200,
    });
    crawlerParser.parse.mockReturnValue(parsedPage);

    await expect(
      usecase.execute({ url: 'https://example.com' }),
    ).resolves.toEqual({
      url: 'https://example.com',
      status: 'SUCCESS',
      data: parsedPage,
    });
    expect(crawlerRequester.request).toHaveBeenCalledWith({
      url: 'https://example.com',
    });
    expect(crawlerParser.parse).toHaveBeenCalledWith(
      '<html></html>',
      'https://example.com/final',
    );
  });

  it('대상 서버의 일시적 오류는 재시도 가능한 예외로 전파한다', async () => {
    crawlerRequester.request.mockResolvedValue({
      requestedUrl: 'https://example.com',
      finalUrl: 'https://example.com',
      html: '<html></html>',
      responseStatus: 503,
    });

    await expect(
      usecase.execute({ url: 'https://example.com' }),
    ).rejects.toMatchObject({
      errorCode: 'CRAWL_TARGET_UNAVAILABLE',
      status: DomainStatus.SERVICE_UNAVAILABLE,
    });
    expect(crawlerParser.parse).not.toHaveBeenCalled();
  });
});
