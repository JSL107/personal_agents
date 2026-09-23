import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeleteScheduleUsecase } from '../application/delete-schedule.usecase';
import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
import { RegisterConsoleScheduleUsecase } from '../application/register-console-schedule.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { ScheduleConsoleController } from './schedule-console.controller';

describe('ScheduleConsoleController', () => {
  const record: ScheduleItemRecord = {
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
    const listSchedules: jest.Mocked<Pick<ListSchedulesUsecase, 'execute'>> = {
      execute: jest.fn().mockResolvedValue([record]),
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
    const controller = new ScheduleConsoleController(
      listSchedules as unknown as ListSchedulesUsecase,
      registerSchedule as unknown as RegisterConsoleScheduleUsecase,
      updateStatus as unknown as UpdateScheduleStatusUsecase,
      deleteSchedule as unknown as DeleteScheduleUsecase,
      configService as unknown as ConfigService,
    );
    return {
      controller,
      listSchedules,
      registerSchedule,
      updateStatus,
      deleteSchedule,
      configService,
    };
  };

  describe('list', () => {
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
