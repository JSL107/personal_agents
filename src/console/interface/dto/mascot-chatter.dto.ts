import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
} from 'class-validator';

// 오늘 [나중에]를 누른 후보. 서버가 실제 제안 후보와 교집합으로 걸러 쓴다.
export class MascotChatterDto {
  @IsOptional()
  @IsIn(['IDLE', 'EVENTS', 'RETURN', 'PROGRESS'])
  trigger?: 'IDLE' | 'EVENTS' | 'RETURN' | 'PROGRESS';

  @IsOptional()
  @IsISO8601()
  since?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  declinedAgentTypes?: string[];
}
