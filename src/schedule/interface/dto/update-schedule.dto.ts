import { IsEnum } from 'class-validator';

import { ScheduleStatus } from '../../domain/schedule.type';

export class UpdateScheduleDto {
  @IsEnum(ScheduleStatus)
  status!: ScheduleStatus;
}
