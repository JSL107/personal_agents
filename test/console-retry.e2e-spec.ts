import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';

import { AllExceptionsFilter } from './../src/common/filter/all-exceptions.filter';
import { LoopbackOnlyGuard } from './../src/common/guard/loopback-only.guard';
import { ResponseInterceptor } from './../src/common/interceptor/response.interceptor';
import { ConsoleRetryTracker } from './../src/console/application/console-retry-tracker';
import { ConsoleWriteService } from './../src/console/application/console-write.service';
import { PendingConsoleTurnStore } from './../src/console/application/pending-console-turn.store';
import { PreconditionChainOrchestrator } from './../src/console/application/precondition-chain.orchestrator';
import { ConsoleWriteController } from './../src/console/interface/console-write.controller';
import { SessionInjectService } from './../src/local-sessions/application/session-inject.service';
import { ApplyPreviewUsecase } from './../src/preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from './../src/preview-gate/application/cancel-preview.usecase';
import { ReplayFailedRunUsecase } from './../src/run-replay/application/replay-failed-run.usecase';
import { ReplayRejectionCode } from './../src/run-replay/domain/run-replay.type';

// 재시도 거절이 앱에 그대로 읽히는 모양(HTTP 상태 + 봉투 message)으로 나가는지 — 앱은
// 202 만 접수로 보고, 나머지는 message 를 화면에 띄운다(`runRetryOutcome`).
describe('POST /v1/console/runs/:id/retry (e2e)', () => {
  let app: INestApplication;
  let prepare: jest.Mock;

  beforeEach(async () => {
    prepare = jest.fn();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConsoleWriteController],
      providers: [
        ConsoleWriteService,
        ConsoleRetryTracker,
        LoopbackOnlyGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'CONSOLE_OWNER_SLACK_USER_ID' ? 'U_OWNER' : undefined,
          },
        },
        { provide: ReplayFailedRunUsecase, useValue: { prepare } },
        { provide: PreconditionChainOrchestrator, useValue: {} },
        { provide: ApplyPreviewUsecase, useValue: {} },
        { provide: CancelPreviewUsecase, useValue: {} },
        { provide: PendingConsoleTurnStore, useValue: {} },
        { provide: SessionInjectService, useValue: {} },
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

  const post = (id: string) =>
    request(app.getHttpAdapter().getInstance()).post(
      `/v1/console/runs/${id}/retry`,
    );

  it('판정을 통과하면 202 로 접수하고 owner 명의로 판정을 받는다', async () => {
    prepare.mockResolvedValue({
      kind: 'READY',
      agentType: 'PM',
      runId: 42,
      run: () => new Promise(() => undefined),
    });

    const response = await post('42');

    expect(response.status).toBe(202);
    expect(prepare).toHaveBeenCalledWith({
      runId: 42,
      requesterSlackUserId: 'U_OWNER',
    });
  });

  it('거절은 상태 코드와 Slack 과 같은 문구로 돌아온다', async () => {
    prepare.mockResolvedValue({
      kind: 'REJECTED',
      code: ReplayRejectionCode.NOT_FOUND,
      message: 'run #42 를 찾을 수 없거나 FAILED 상태가 아닙니다.',
    });

    const response = await post('42');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: 'RUN_REPLAY_NOT_FOUND',
      message: 'run #42 를 찾을 수 없거나 FAILED 상태가 아닙니다.',
    });
  });

  it('도는 중인 run 을 다시 누르면 409', async () => {
    prepare.mockResolvedValue({
      kind: 'READY',
      agentType: 'PM',
      runId: 42,
      run: () => new Promise(() => undefined),
    });

    await post('42');
    const response = await post('42');

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'RUN_REPLAY_IN_FLIGHT' });
  });

  it('숫자가 아닌 id 는 판정 전에 400', async () => {
    const response = await post('abc');

    expect(response.status).toBe(400);
    expect(prepare).not.toHaveBeenCalled();
  });
});
