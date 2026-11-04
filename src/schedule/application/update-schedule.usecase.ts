import { BadRequestException, Injectable } from '@nestjs/common';

import { ScheduleFieldsPatch } from '../domain/schedule.repository.type';
import { ScheduleItemRecord, ScheduleStatus } from '../domain/schedule.type';
import { UpdateScheduleFieldsUsecase } from './update-schedule-fields.usecase';
import { UpdateScheduleStatusUsecase } from './update-schedule-status.usecase';

export interface UpdateScheduleInput {
  id: number;
  slackUserId: string;
  status?: ScheduleStatus;
  patch: ScheduleFieldsPatch;
}

@Injectable()
export class UpdateScheduleUsecase {
  constructor(
    private readonly updateFields: UpdateScheduleFieldsUsecase,
    private readonly updateStatus: UpdateScheduleStatusUsecase,
  ) {}

  async execute({
    id,
    slackUserId,
    status,
    patch,
  }: UpdateScheduleInput): Promise<ScheduleItemRecord> {
    const fields = { ...patch };
    if (fields.title !== undefined) {
      const title = fields.title.trim();
      if (!title) {
        throw new BadRequestException('제목을 입력하세요.');
      }
      fields.title = title;
    }
    const hasFields = Object.keys(fields).length > 0;
    if (status) {
      if (hasFields) {
        const prepared = await this.updateFields.prepare({
          id,
          slackUserId,
          patch: fields,
        });
        return this.updateStatus.execute({
          id,
          status,
          slackUserId,
          patch: prepared.patch,
          expected: prepared.expected,
        });
      }
      return this.updateStatus.execute({ id, status, slackUserId });
    }
    if (hasFields) {
      return this.updateFields.execute({ id, slackUserId, patch: fields });
    }
    throw new BadRequestException('수정할 내용을 입력하세요.');
  }
}
