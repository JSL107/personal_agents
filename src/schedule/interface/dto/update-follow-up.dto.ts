import {
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateFollowUpDto {
  @ValidateIf((input: UpdateFollowUpDto) => input.recipient !== undefined)
  @IsString()
  @MaxLength(100)
  recipient?: string;

  @ValidateIf((input: UpdateFollowUpDto) => input.topic !== undefined)
  @IsString()
  @MaxLength(200)
  topic?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  triggerAt?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  )
  sentAt?: string;
}
