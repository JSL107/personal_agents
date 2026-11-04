import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { LoopbackOnlyGuard } from '../src/common/guard/loopback-only.guard';
import { ConsoleReadGuard } from '../src/console/interface/console-read.guard';
import { DeleteScheduleUsecase } from '../src/schedule/application/delete-schedule.usecase';
import { ListSchedulesUsecase } from '../src/schedule/application/list-schedules.usecase';
import { RegisterConsoleScheduleUsecase } from '../src/schedule/application/register-console-schedule.usecase';
import { ScheduleFollowUpUsecase } from '../src/schedule/application/schedule-follow-up.usecase';
import { UpdateScheduleUsecase } from '../src/schedule/application/update-schedule.usecase';
import { ScheduleConsoleController } from '../src/schedule/interface/schedule-console.controller';

describe('ScheduleConsoleController HTTP', () => {
  let app: INestApplication;
  const list = {
    execute: jest.fn().mockResolvedValue([]),
    tracking: jest.fn().mockResolvedValue([]),
    undated: jest.fn().mockResolvedValue([]),
  };
  const followUp = {
    detail: jest.fn(),
    withPendingCounts: jest
      .fn()
      .mockImplementation((items) => Promise.resolve(items)),
    add: jest.fn(),
    update: jest.fn(),
    note: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [ScheduleConsoleController],
      providers: [
        { provide: ListSchedulesUsecase, useValue: list },
        {
          provide: RegisterConsoleScheduleUsecase,
          useValue: { execute: jest.fn() },
        },
        { provide: DeleteScheduleUsecase, useValue: { execute: jest.fn() } },
        {
          provide: UpdateScheduleUsecase,
          useValue: { execute: jest.fn() },
        },
        { provide: ScheduleFollowUpUsecase, useValue: followUp },
        { provide: ConfigService, useValue: { get: () => 'U_OWNER' } },
        ConsoleReadGuard,
        LoopbackOnlyGuard,
      ],
    })
      .overrideGuard(ConsoleReadGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(LoopbackOnlyGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET schedules/undated 는 :id ParseIntPipe보다 먼저 매칭해 목록을 준다', async () => {
    const response = await request(app.getHttpServer()).get(
      '/v1/console/schedules/undated',
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(list.undated).toHaveBeenCalledWith('U_OWNER');
  });

  it('PATCH 빈 본문과 미선언 키는 400이다', async () => {
    await request(app.getHttpServer())
      .patch('/v1/console/schedules/1')
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/v1/console/schedules/1')
      .send({ unknown: true })
      .expect(400);
  });
});
