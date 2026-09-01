import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AllExceptionsFilter } from './../src/common/filter/all-exceptions.filter';
import { LoopbackOnlyGuard } from './../src/common/guard/loopback-only.guard';
import { ResponseInterceptor } from './../src/common/interceptor/response.interceptor';
import { CrawlUsecase } from './../src/crawler/application/crawl.usecase';
import { CRAWL_QUEUE_PORT } from './../src/crawler/domain/port/crawl-queue.port';
import { CrawlerController } from './../src/crawler/interface/crawler.controller';

describe('CrawlerController (e2e)', () => {
  let app: INestApplication;
  let crawlQueuePort: { enqueue: jest.Mock };

  beforeEach(async () => {
    crawlQueuePort = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CrawlerController],
      providers: [
        CrawlUsecase,
        LoopbackOnlyGuard,
        {
          provide: CRAWL_QUEUE_PORT,
          useValue: crawlQueuePort,
        },
        {
          // 가드가 토큰을 조회한다. 미설정이어도 loopback 이면 통과하는 것이 정상 동작이다.
          provide: ConfigService,
          useValue: { get: () => undefined },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /v1/crawl-jobs — 유효하지 않은 URL은 400을 반환한다', () => {
    return request(app.getHttpAdapter().getInstance())
      .post('/v1/crawl-jobs')
      .send({ url: 'not-a-url' })
      .expect(400);
  });

  it('POST /v1/crawl-jobs — 유효한 요청은 큐 등록 후 성공 응답을 반환한다', async () => {
    const response = await request(app.getHttpAdapter().getInstance())
      .post('/v1/crawl-jobs')
      .send({ url: 'https://example.com' })
      .expect(201);

    expect(crawlQueuePort.enqueue).toHaveBeenCalledTimes(1);
    expect(crawlQueuePort.enqueue).toHaveBeenCalledWith({
      url: 'https://example.com',
    });
    expect(response.body).toEqual({
      code: 'SUCCESS',
      message: '요청이 성공적으로 처리되었습니다.',
      data: null,
    });
  });

  // 가드가 이 컨트롤러에 실제로 붙어 있는지 — 가드 클래스 유닛 테스트로는 배선을 증명하지 못한다.
  // 거부하는 가드로 갈아 끼웠을 때 403 이 나와야 "요청이 가드를 지난다" 가 증명된다.
  it('LoopbackOnlyGuard 가 거부하면 요청이 컨트롤러에 닿지 않는다', async () => {
    const denied: TestingModule = await Test.createTestingModule({
      controllers: [CrawlerController],
      providers: [
        CrawlUsecase,
        LoopbackOnlyGuard,
        { provide: CRAWL_QUEUE_PORT, useValue: crawlQueuePort },
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    })
      .overrideGuard(LoopbackOnlyGuard)
      .useValue({ canActivate: () => false })
      .compile();

    const deniedApp = denied.createNestApplication();
    await deniedApp.init();
    try {
      await request(deniedApp.getHttpAdapter().getInstance())
        .post('/v1/crawl-jobs')
        .send({ url: 'https://example.com' })
        .expect(403);
      expect(crawlQueuePort.enqueue).not.toHaveBeenCalled();
    } finally {
      await deniedApp.close();
    }
  });
});
