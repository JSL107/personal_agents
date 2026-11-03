import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeleteScheduleUsecase } from '../application/delete-schedule.usecase';
import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
import { RegisterConsoleScheduleUsecase } from '../application/register-console-schedule.usecase';
import { ScheduleFollowUpUsecase } from '../application/schedule-follow-up.usecase';
import { UpdateScheduleFieldsUsecase } from '../application/update-schedule-fields.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import {
  DatedScheduleItemRecord,
  ScheduleStatus,
} from '../domain/schedule.type';
import { ScheduleConsoleController } from './schedule-console.controller';

describe('ScheduleConsoleController', () => {
  const record: DatedScheduleItemRecord = {
    id: 1,
    slackUserId: 'U123',
    title: '분기 보고서 제출',
    dueDate: new Date('2026-09-30T00:00:00.000Z'),
    dueTime: null,
    linkUrl: null,
    memo: null,
    status: ScheduleStatus.OPEN,
    completedAt: null,
    isHoliday: false,
  };

  const buildController = (ownerConfigValue: string | undefined) => {
    const listSchedules: jest.Mocked<
      Pick<ListSchedulesUsecase, 'execute' | 'tracking' | 'undated'>
    > = {
      execute: jest.fn().mockResolvedValue([record]),
      tracking: jest.fn().mockResolvedValue([record]),
      undated: jest.fn().mockResolvedValue([]),
    };
    const updateStatus: jest.Mocked<
      Pick<UpdateScheduleStatusUsecase, 'execute'>
    > = {
      execute: jest.fn().mockResolvedValue(record),
    };
    const deleteSchedule: jest.Mocked<Pick<DeleteScheduleUsecase, 'execute'>> =
      {
        execute: jest.fn().mockResolvedValue(undefined),
      };
    const registerSchedule: jest.Mocked<
      Pick<RegisterConsoleScheduleUsecase, 'execute'>
    > = {
      execute: jest.fn().mockResolvedValue(record),
    };
    const configService: jest.Mocked<Pick<ConfigService, 'get'>> = {
      get: jest.fn().mockReturnValue(ownerConfigValue),
    };
    const updateFields = {
      execute: jest.fn().mockResolvedValue(record),
      prepare: jest.fn(),
    };
    const followUp = {
      detail: jest.fn().mockResolvedValue({
        item: record,
        followUps: [],
        events: [],
        pendingFollowUpCount: 0,
      }),
      withPendingCounts: jest
        .fn()
        .mockImplementation((items: unknown) => Promise.resolve(items)),
      add: jest.fn(),
      update: jest.fn(),
      note: jest.fn(),
    };
    const controller = new ScheduleConsoleController(
      listSchedules as unknown as ListSchedulesUsecase,
      registerSchedule as unknown as RegisterConsoleScheduleUsecase,
      updateStatus as unknown as UpdateScheduleStatusUsecase,
      deleteSchedule as unknown as DeleteScheduleUsecase,
      configService as unknown as ConfigService,
      updateFields as unknown as UpdateScheduleFieldsUsecase,
      followUp as unknown as ScheduleFollowUpUsecase,
    );
    return {
      controller,
      listSchedules,
      registerSchedule,
      updateStatus,
      deleteSchedule,
      configService,
      updateFields,
      followUp,
    };
  };

  describe('list', () => {
    it('옛 앱 목록에서는 진행 중을 OPEN으로 투영하고 후보를 제외한다', async () => {
      const { controller, listSchedules } = buildController('U123');
      listSchedules.execute.mockResolvedValueOnce([
        { ...record, id: 1, status: ScheduleStatus.IN_PROGRESS },
        { ...record, id: 2, status: ScheduleStatus.CANDIDATE },
      ]);
      const result = await controller.list('2026-09-01', '2026-09-30');
      expect(result).toEqual([
        { ...record, id: 1, status: ScheduleStatus.OPEN },
      ]);
    });

    it('view=tracking이면 시작일 또는 마감일의 월 추적 조회를 쓴다', async () => {
      const { controller, listSchedules } = buildController('U123');
      await controller.list('2026-09-01', '2026-09-30', 'tracking');
      expect(listSchedules.tracking).toHaveBeenCalledWith(
        expect.objectContaining({ slackUserId: 'U123' }),
      );
      expect(listSchedules.execute).not.toHaveBeenCalled();
    });

    it('콘솔 소유자 slackUserId 로 날짜 범위를 조회한다', async () => {
      const { controller, listSchedules, configService } =
        buildController('U123');

      const result = await controller.list('2026-09-01', '2026-09-30');

      expect(configService.get).toHaveBeenCalledWith(
        'CONSOLE_OWNER_SLACK_USER_ID',
      );
      expect(listSchedules.execute).toHaveBeenCalledWith({
        slackUserId: 'U123',
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-30T00:00:00.000Z'),
      });
      expect(result).toEqual([record]);
    });

    it('달력에 없는 날짜는 usecase 호출 전에 던진다', async () => {
      const { controller, listSchedules } = buildController('U123');

      await expect(
        controller.list('2026-02-31', '2026-09-30'),
      ).rejects.toThrow();
      expect(listSchedules.execute).not.toHaveBeenCalled();
    });

    it('CONSOLE_OWNER_SLACK_USER_ID 미설정이면 503 으로 던진다 — getOrThrow 의 500 을 피한다', async () => {
      const { controller, listSchedules } = buildController(undefined);

      await expect(controller.list('2026-09-01', '2026-09-30')).rejects.toThrow(
        ServiceUnavailableException,
      );
      expect(listSchedules.execute).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('제목·날짜·메모를 다듬어 소유자 이름으로 등록한다', async () => {
      const { controller, registerSchedule } = buildController('U123');

      const result = await controller.create({
        title: '  분기 보고서 제출  ',
        dueDate: '2026-09-30',
        memo: '  위택스에서  ',
      });

      expect(registerSchedule.execute).toHaveBeenCalledWith({
        slackUserId: 'U123',
        title: '분기 보고서 제출',
        // 저장 직전까지 PlainDate 로 옮긴다 — Date 로 바꾸면 타임존이 끼어 하루가 밀린다.
        dueDate: { year: 2026, month: 9, day: 30 },
        memo: '위택스에서',
      });
      expect(result).toBe(record);
    });

    it('공백만 남는 메모는 저장하지 않는다 — 빈 메모 줄이 상세에 그려지는 것을 막는다', async () => {
      const { controller, registerSchedule } = buildController('U123');

      await controller.create({
        title: '분기 보고서 제출',
        dueDate: '2026-09-30',
        memo: '   ',
      });

      expect(registerSchedule.execute).toHaveBeenCalledWith(
        expect.objectContaining({ memo: undefined }),
      );
    });

    it('공백만 친 제목은 400 으로 끊는다 — MaxLength 만으로는 통과한다', async () => {
      const { controller, registerSchedule } = buildController('U123');

      await expect(
        controller.create({ title: '   ', dueDate: '2026-09-30' }),
      ).rejects.toThrow(BadRequestException);
      expect(registerSchedule.execute).not.toHaveBeenCalled();
    });

    it('달력에 없는 날짜는 400 으로 끊는다 — 조용히 다음 달로 굴러가는 것을 막는다', async () => {
      const { controller, registerSchedule } = buildController('U123');

      await expect(
        controller.create({ title: '분기 보고서 제출', dueDate: '2026-02-30' }),
      ).rejects.toThrow(BadRequestException);
      expect(registerSchedule.execute).not.toHaveBeenCalled();
    });

    it('CONSOLE_OWNER_SLACK_USER_ID 미설정이면 503 으로 던지고 등록하지 않는다', async () => {
      const { controller, registerSchedule } = buildController(undefined);

      await expect(
        controller.create({ title: '분기 보고서 제출', dueDate: '2026-09-30' }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(registerSchedule.execute).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('옛 앱의 PATCH 응답도 진행 중을 OPEN으로 투영한다', async () => {
      const { controller, updateStatus } = buildController('U123');
      updateStatus.execute.mockResolvedValueOnce({
        ...record,
        status: ScheduleStatus.IN_PROGRESS,
      });
      const result = await controller.update(1, {
        status: ScheduleStatus.IN_PROGRESS,
      });
      expect(result.status).toBe(ScheduleStatus.OPEN);
    });

    it('상태와 필드를 함께 수정하면 단일 전이에 필드를 전달한다', async () => {
      const { controller, updateStatus, updateFields } =
        buildController('U123');
      const expected = {
        dueDate: record.dueDate,
        startDate: null,
        dueTime: null,
      };
      updateFields.prepare = jest
        .fn()
        .mockResolvedValue({ patch: { title: '변경' }, expected });
      await controller.update(
        1,
        { status: ScheduleStatus.DONE, title: '변경' },
        'tracking',
      );
      expect(updateFields.execute).not.toHaveBeenCalled();
      expect(updateStatus.execute).toHaveBeenCalledWith(
        expect.objectContaining({ patch: { title: '변경' }, expected }),
      );
    });

    it('id·status 와 함께 소유자를 넘긴다 — 변경도 조회와 같은 범위로 묶는다', async () => {
      const { controller, updateStatus } = buildController('U123');

      const result = await controller.update(1, {
        status: ScheduleStatus.DONE,
      });

      expect(updateStatus.execute).toHaveBeenCalledWith({
        id: 1,
        status: ScheduleStatus.DONE,
        slackUserId: 'U123',
      });
      expect(result).toBe(record);
    });
  });

  it('연락할 일의 받는 사람이나 주제를 공백으로 수정하지 않는다', async () => {
    const { controller } = buildController('U123');
    await expect(
      controller.updateFollowUp(1, { recipient: '  ' }),
    ).rejects.toThrow(BadRequestException);
    await expect(controller.updateFollowUp(1, { topic: '  ' })).rejects.toThrow(
      BadRequestException,
    );
  });

  describe('remove', () => {
    it('DeleteScheduleUsecase 에 id 와 소유자를 위임한다 — 없는 id 의 404 처리는 usecase 가 맡는다', async () => {
      const { controller, deleteSchedule } = buildController('U123');

      await controller.remove(1);

      expect(deleteSchedule.execute).toHaveBeenCalledWith({
        id: 1,
        slackUserId: 'U123',
      });
    });
  });
});

describe('ScheduleConsoleController 추적 API 계약', () => {
  it('기한 없음 라우트가 숫자 id 라우트보다 앞에 선언된다', () => {
    const names = Object.getOwnPropertyNames(
      ScheduleConsoleController.prototype,
    );
    expect(names.indexOf('undated')).toBeGreaterThan(-1);
    expect(names.indexOf('detail')).toBeGreaterThan(names.indexOf('undated'));
  });

  it('PATCH DTO는 빈 본문과 미선언 필드를 거부하며 상태만 있는 옛 앱 요청은 받는다', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { UpdateScheduleDto } = await import('./dto/update-schedule.dto');
    const options = { whitelist: true, forbidNonWhitelisted: true };
    const empty = await validate(
      plainToInstance(UpdateScheduleDto, {}),
      options,
    );
    const unknown = await validate(
      plainToInstance(UpdateScheduleDto, {
        status: ScheduleStatus.DONE,
        unknown: true,
      }),
      options,
    );
    const old = await validate(
      plainToInstance(UpdateScheduleDto, { status: ScheduleStatus.DONE }),
      options,
    );
    expect(empty.length).toBeGreaterThan(0);
    expect(unknown.length).toBeGreaterThan(0);
    expect(old).toEqual([]);
  });

  it('PATCH DTO는 잘못된 시간과 제목 null을 거부하며 알림 null은 허용한다', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { UpdateScheduleDto } = await import('./dto/update-schedule.dto');
    const invalidTime = await validate(
      plainToInstance(UpdateScheduleDto, { dueTime: '25:80' }),
    );
    const invalidTitle = await validate(
      plainToInstance(UpdateScheduleDto, { title: null }),
    );
    const reminderOff = await validate(
      plainToInstance(UpdateScheduleDto, { remindAt: null }),
    );
    expect(invalidTime.length).toBeGreaterThan(0);
    expect(invalidTitle.length).toBeGreaterThan(0);
    expect(reminderOff).toEqual([]);
  });
});
