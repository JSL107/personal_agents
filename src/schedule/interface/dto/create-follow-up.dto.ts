import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import { FollowUpTrigger } from '../../domain/schedule.type';

export class CreateFollowUpDto {
  @IsString()
  @MaxLength(100)
  recipient!: string;

  @IsString()
  @MaxLength(200)
  topic!: string;

  @IsEnum(FollowUpTrigger)
  trigger!: FollowUpTrigger;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  triggerAt?: string;
}
