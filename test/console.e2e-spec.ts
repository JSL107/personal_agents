import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AgentRunService } from './../src/agent-run/application/agent-run.service';
import { AllExceptionsFilter } from './../src/common/filter/all-exceptions.filter';
import { ResponseInterceptor } from './../src/common/interceptor/response.interceptor';
import { ConsoleEventBus } from './../src/console/application/console-event-bus.service';
import { ConsoleReadService } from './../src/console/application/console-read.service';
import { ConsoleController } from './../src/console/interface/console.controller';
import { ConsoleStreamController } from './../src/console/interface/console-stream.controller';
import { FindAllOpenPreviewsUsecase } from './../src/preview-gate/application/find-all-open-previews.usecase';

describe('ConsoleController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController, ConsoleStreamController],
      providers: [
        ConsoleReadService,
        ConsoleEventBus,
        {
          provide: AgentRunService,
          useValue: { findActiveRuns: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: FindAllOpenPreviewsUsecase,
          useValue: { execute: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /v1/console/snapshot 는 200 + data.agents 배열(레지스트리 전원)', async () => {
    const response = await request(app.getHttpAdapter().getInstance()).get(
      '/v1/console/snapshot',
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data.agents)).toBe(true);
    expect(response.body.data.agents.length).toBeGreaterThan(0);
    expect(Array.isArray(response.body.data.runs)).toBe(true);
    expect(typeof response.body.data.serverTime).toBe('string');
  });

  it('GET /v1/console/approvals 는 200 + data 배열', async () => {
    const response = await request(app.getHttpAdapter().getInstance()).get(
      '/v1/console/approvals',
    );

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });
});
