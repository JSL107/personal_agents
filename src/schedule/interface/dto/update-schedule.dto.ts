import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { ScheduleStatus } from '../../domain/schedule.type';

export class UpdateScheduleDto {
  @ValidateIf(
    (input: UpdateScheduleDto) =>
      input.status !== undefined ||
      [
        input.title,
        input.dueDate,
        input.dueTime,
        input.startDate,
        input.remindAt,
      ].every((value) => value === undefined),
  )
  @IsEnum(ScheduleStatus)
  status?: ScheduleStatus;

  @ValidateIf((input: UpdateScheduleDto) => input.title !== undefined)
  @IsString()
  @MaxLength(200)
  title?: string;

  @ValidateIf((input: UpdateScheduleDto) => input.dueDate !== undefined)
  @IsString()
  dueDate?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime?: string | null;

  @IsOptional()
  @IsString()
  startDate?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  remindAt?: string | null;
}
