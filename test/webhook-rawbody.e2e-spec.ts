import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'crypto';
import * as express from 'express';
import * as request from 'supertest';

import { AllExceptionsFilter } from './../src/common/filter/all-exceptions.filter';
import { ResponseInterceptor } from './../src/common/interceptor/response.interceptor';
import {
  CODE_REVIEWER_QUEUE,
  IMPACT_REPORT_QUEUE,
  ISSUE_LABEL_QUEUE,
  PR_CAREERLOG_QUEUE,
} from './../src/webhook/domain/webhook.type';
import { WebhookController } from './../src/webhook/interface/webhook.controller';

// 웹훅 본문은 **문자열 그대로** 컨트롤러에 닿아야 HMAC 이 맞는다. `main.ts` 가
// `express.text({ type: '*/*' })` 를 그 경로에 얹어 두는 이유가 그것이다 — 프레임워크가
// application/json 을 객체로 파싱해 버리면 서명 계산 대상이 달라져 전부 401 이 된다.
//
// 이 계약은 Nest·Express 를 올릴 때 가장 먼저 깨지는 자리인데(본문 파서가 그 둘 사이에 있다)
// 유닛 테스트는 컨트롤러에 문자열을 직접 넘겨서 그 사이를 건너뛴다. 그래서 실제 HTTP 로 확인한다.
const SECRET = 'test-webhook-secret';

function sign(body: string): string {
  return `sha256=${crypto.createHmac('sha256', SECRET).update(body).digest('hex')}`;
}

describe('Webhook rawBody (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WebhookController],
      providers: [
        { provide: getQueueToken(IMPACT_REPORT_QUEUE), useValue: queue },
        { provide: getQueueToken(CODE_REVIEWER_QUEUE), useValue: queue },
        { provide: getQueueToken(PR_CAREERLOG_QUEUE), useValue: queue },
        { provide: getQueueToken(ISSUE_LABEL_QUEUE), useValue: queue },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'WEBHOOK_SECRET' ? SECRET : undefined,
          },
        },
      ],
    }).compile();

    // main.ts 와 같은 순서로 조립한다 — rawBody 옵션, 경로별 text 파서, 전역 파이프/필터/인터셉터.
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.use('/v1/agent/trigger', express.text({ type: '*/*', limit: '1mb' }));
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

  it('application/json 본문이 파싱되지 않고 문자열 그대로 닿아 서명이 맞는다', async () => {
    const body = JSON.stringify({
      event: 'ping',
      repo: 'JSL107/personal_agents',
      data: {},
    });

    await request(app.getHttpAdapter().getInstance())
      .post('/v1/agent/trigger')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', sign(body))
      .send(body)
      .expect(200);
  });

  // 서명이 본문에서 나온다는 것을 확인하는 대조군. 이 단언이 없으면 위 성공은
  // "서명 검증을 아예 안 한다" 로도 통과한다.
  it('본문이 한 글자라도 다르면 401 이다', async () => {
    const signed = JSON.stringify({ event: 'ping', repo: 'a', data: {} });
    const sent = JSON.stringify({ event: 'ping', repo: 'b', data: {} });

    await request(app.getHttpAdapter().getInstance())
      .post('/v1/agent/trigger')
      .set('Content-Type', 'application/json')
      .set('x-webhook-signature', sign(signed))
      .send(sent)
      .expect(401);
  });
});
