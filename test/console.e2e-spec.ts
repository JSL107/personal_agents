import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AgentRunService } from './../src/agent-run/application/agent-run.service';
import { AllExceptionsFilter } from './../src/common/filter/all-exceptions.filter';
import { ResponseInterceptor } from './../src/common/interceptor/response.interceptor';
import { BuildActivityUsecase } from './../src/console/application/build-activity.usecase';
import { BuildDeliverySummaryUsecase } from './../src/console/application/build-delivery-summary.usecase';
import { BuildLedgerUsecase } from './../src/console/application/build-ledger.usecase';
import { BuildPresidentBriefingUsecase } from './../src/console/application/build-president-briefing.usecase';
import { ConsoleEventBus } from './../src/console/application/console-event-bus.service';
import { ConsoleReadService } from './../src/console/application/console-read.service';
import { ListDeliveriesUsecase } from './../src/console/application/list-deliveries.usecase';
import { ConsoleController } from './../src/console/interface/console.controller';
import { ConsoleReadGuard } from './../src/console/interface/console-read.guard';
import { ConsoleStreamController } from './../src/console/interface/console-stream.controller';
import { LocalSessionService } from './../src/local-sessions/application/local-session.service';
import { MEMORY_VACUUM_PORT } from './../src/memory-vacuum/domain/port/memory-vacuum.port';
import { ApplyPreviewUsecase } from './../src/preview-gate/application/apply-preview.usecase';
import { FindAllOpenPreviewsUsecase } from './../src/preview-gate/application/find-all-open-previews.usecase';
import { AGENT_DISPATCHER_PORT } from './../src/router/domain/port/agent-dispatcher.port';

// 컨트롤러가 요구하는 협력자 목록. 정상 경로와 "가드가 거부하는" 경로가 같은 목록을 쓴다.
function consoleProviders() {
  return [
    ConsoleReadService,
    ConsoleEventBus,
    ConsoleReadGuard,
    {
      provide: AgentRunService,
      useValue: {
        findActiveRuns: jest.fn().mockResolvedValue([]),
        findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
        countSucceededSince: jest.fn().mockResolvedValue([]),
      },
    },
    {
      provide: FindAllOpenPreviewsUsecase,
      useValue: { execute: jest.fn().mockResolvedValue([]) },
    },
    {
      provide: ApplyPreviewUsecase,
      useValue: { isApplying: () => false },
    },
    {
      provide: LocalSessionService,
      useValue: { list: jest.fn().mockReturnValue([]) },
    },
    {
      provide: MEMORY_VACUUM_PORT,
      useValue: { lastState: jest.fn().mockResolvedValue(null) },
    },
    // 실제 모듈에서는 RouterModule 이 담당자 dispatcher 배열을 넣는다. 비어 있어도 스냅샷은
    // 레지스트리 전원을 낸다(canDispatch 만 전부 false).
    { provide: AGENT_DISPATCHER_PORT, useValue: [] },
    {
      provide: BuildActivityUsecase,
      useValue: { execute: jest.fn().mockResolvedValue({}) },
    },
    {
      provide: BuildDeliverySummaryUsecase,
      useValue: { execute: jest.fn().mockResolvedValue({}) },
    },
    {
      provide: ListDeliveriesUsecase,
      useValue: { execute: jest.fn().mockResolvedValue({}) },
    },
    {
      provide: BuildPresidentBriefingUsecase,
      useValue: { execute: jest.fn().mockResolvedValue({}) },
    },
    {
      provide: BuildLedgerUsecase,
      useValue: { execute: jest.fn().mockResolvedValue({}) },
    },
    {
      // 토큰 미설정 + loopback — 맥 앱의 평소 상태다. 그대로 읽혀야 한다.
      provide: ConfigService,
      useValue: { get: () => undefined },
    },
  ];
}

describe('ConsoleController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController, ConsoleStreamController],
      providers: consoleProviders(),
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.init();
  });

  // beforeEach 가 compile 에서 실패하면 app 이 비어 있다. 그때 close 가 TypeError 를 던지면
  // 진짜 원인(DI 누락) 옆에 가짜 오류가 하나 더 붙는다.
  afterEach(async () => {
    await app?.close();
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

  // 가드 배선 증명. 위 두 테스트가 200 인 것은 "loopback 이라 통과" 와 "가드가 아예 없다" 를
  // 구분하지 못한다 — 거부하는 가드로 갈아 끼워 403 을 확인해야 이 경로가 가드를 지난다는
  // 증거가 된다. SSE 도 같은 가드를 지나는지 함께 본다.
  it('ConsoleReadGuard 가 거부하면 스냅샷·브리핑·스트림 모두 막힌다', async () => {
    const denied: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleController, ConsoleStreamController],
      providers: consoleProviders(),
    })
      .overrideGuard(ConsoleReadGuard)
      .useValue({ canActivate: () => false })
      .compile();

    const deniedApp = denied.createNestApplication();
    await deniedApp.init();
    try {
      const server = deniedApp.getHttpAdapter().getInstance();
      await request(server).get('/v1/console/snapshot').expect(403);
      await request(server).get('/v1/console/briefing').expect(403);
      await request(server).get('/v1/console/stream').expect(403);
    } finally {
      await deniedApp.close();
    }
  });
});
