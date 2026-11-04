import { BadRequestException } from '@nestjs/common';

import { ScheduleStatus } from '../domain/schedule.type';
import { UpdateScheduleUsecase } from './update-schedule.usecase';
import { UpdateScheduleFieldsUsecase } from './update-schedule-fields.usecase';
import { UpdateScheduleStatusUsecase } from './update-schedule-status.usecase';

describe('UpdateScheduleUsecase', () => {
  const buildUsecase = () => {
    const item = { id: 1, status: ScheduleStatus.DONE } as never;
    const updateFields = {
      prepare: jest.fn(),
      execute: jest.fn().mockResolvedValue(item),
    };
    const updateStatus = { execute: jest.fn().mockResolvedValue(item) };
    const usecase = new UpdateScheduleUsecase(
      updateFields as unknown as UpdateScheduleFieldsUsecase,
      updateStatus as unknown as UpdateScheduleStatusUsecase,
    );
    return { usecase, updateFields, updateStatus, item };
  };

  it('상태와 필드를 함께 수정할 때 준비된 필드를 단일 전이에 전달한다', async () => {
    const { usecase, updateFields, updateStatus, item } = buildUsecase();
    const expected = { dueDate: null, startDate: null, dueTime: null };
    updateFields.prepare.mockResolvedValue({
      patch: { title: '변경' },
      expected,
    });
    const result = await usecase.execute({
      id: 1,
      slackUserId: 'U123',
      status: ScheduleStatus.DONE,
      patch: { title: '  변경  ' },
    });
    expect(updateFields.prepare).toHaveBeenCalledWith({
      id: 1,
      slackUserId: 'U123',
      patch: { title: '변경' },
    });
    expect(updateFields.execute).not.toHaveBeenCalled();
    expect(updateStatus.execute).toHaveBeenCalledWith({
      id: 1,
      slackUserId: 'U123',
      status: ScheduleStatus.DONE,
      patch: { title: '변경' },
      expected,
    });
    expect(result).toBe(item);
  });

  it('상태만 있으면 필드 준비 없이 상태를 수정한다', async () => {
    const { usecase, updateFields, updateStatus } = buildUsecase();
    await usecase.execute({
      id: 1,
      slackUserId: 'U123',
      status: ScheduleStatus.DONE,
      patch: {},
    });
    expect(updateFields.prepare).not.toHaveBeenCalled();
    expect(updateStatus.execute).toHaveBeenCalledWith({
      id: 1,
      slackUserId: 'U123',
      status: ScheduleStatus.DONE,
    });
  });

  it('필드만 있으면 다듬은 제목으로 필드를 수정한다', async () => {
    const { usecase, updateFields, updateStatus } = buildUsecase();
    await usecase.execute({
      id: 1,
      slackUserId: 'U123',
      patch: { title: '  변경  ' },
    });
    expect(updateFields.execute).toHaveBeenCalledWith({
      id: 1,
      slackUserId: 'U123',
      patch: { title: '변경' },
    });
    expect(updateStatus.execute).not.toHaveBeenCalled();
  });

  it('공백 제목과 빈 수정 입력을 각각 400으로 거부한다', async () => {
    const { usecase, updateFields, updateStatus } = buildUsecase();
    await expect(
      usecase.execute({ id: 1, slackUserId: 'U123', patch: { title: '   ' } }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      usecase.execute({ id: 1, slackUserId: 'U123', patch: {} }),
    ).rejects.toThrow(BadRequestException);
    expect(updateFields.execute).not.toHaveBeenCalled();
    expect(updateStatus.execute).not.toHaveBeenCalled();
  });
});
