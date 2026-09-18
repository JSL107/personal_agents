import { ConfigService } from '@nestjs/config';

import { ListSchedulesUsecase } from '../application/list-schedules.usecase';
import { UpdateScheduleStatusUsecase } from '../application/update-schedule-status.usecase';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
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

  const buildController = () => {
    const listSchedules: jest.Mocked<Pick<ListSchedulesUsecase, 'execute'>> = {
      execute: jest.fn().mockResolvedValue([record]),
    };
    const updateStatus: jest.Mocked<
      Pick<UpdateScheduleStatusUsecase, 'execute'>
    > = {
      execute: jest.fn().mockResolvedValue(record),
    };
    const repository: jest.Mocked<Pick<ScheduleRepositoryPort, 'deleteById'>> =
      {
        deleteById: jest.fn().mockResolvedValue(undefined),
      };
    const configService: jest.Mocked<Pick<ConfigService, 'getOrThrow'>> = {
      getOrThrow: jest.fn().mockReturnValue('U123'),
    };
    const controller = new ScheduleConsoleController(
      listSchedules as unknown as ListSchedulesUsecase,
      updateStatus as unknown as UpdateScheduleStatusUsecase,
      configService as unknown as ConfigService,
      repository as unknown as ScheduleRepositoryPort,
    );
    return {
      controller,
      listSchedules,
      updateStatus,
      repository,
      configService,
    };
  };

  describe('list', () => {
    it('콘솔 소유자 slackUserId 로 날짜 범위를 조회한다', async () => {
      const { controller, listSchedules, configService } = buildController();

      const result = await controller.list('2026-09-01', '2026-09-30');

      expect(configService.getOrThrow).toHaveBeenCalledWith(
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
      const { controller, listSchedules } = buildController();

      await expect(
        controller.list('2026-02-31', '2026-09-30'),
      ).rejects.toThrow();
      expect(listSchedules.execute).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('id·status 를 그대로 usecase 에 넘긴다', async () => {
      const { controller, updateStatus } = buildController();

      const result = await controller.update(1, {
        status: ScheduleStatus.DONE,
      });

      expect(updateStatus.execute).toHaveBeenCalledWith({
        id: 1,
        status: ScheduleStatus.DONE,
      });
      expect(result).toBe(record);
    });
  });

  describe('remove', () => {
    it('리포지토리 deleteById 를 호출한다', async () => {
      const { controller, repository } = buildController();

      await controller.remove(1);

      expect(repository.deleteById).toHaveBeenCalledWith(1);
    });
  });
});
