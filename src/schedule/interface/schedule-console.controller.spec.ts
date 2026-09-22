import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DeleteScheduleUsecase } from '../application/delete-schedule.usecase';
import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
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
    const configService: jest.Mocked<Pick<ConfigService, 'get'>> = {
      get: jest.fn().mockReturnValue(ownerConfigValue),
    };
    const controller = new ScheduleConsoleController(
      listSchedules as unknown as ListSchedulesUsecase,
      updateStatus as unknown as UpdateScheduleStatusUsecase,
      deleteSchedule as unknown as DeleteScheduleUsecase,
      configService as unknown as ConfigService,
    );
    return {
      controller,
      listSchedules,
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
