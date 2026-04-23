import { plainToInstance } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  REDIS_HOST!: string;

  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT!: number;

  // DATABASE_URL 은 이 프로젝트의 필수 인프라(Prisma + PostgreSQL) 구성요소다.
  // 강제 지점은 앱 부팅 시 class-validator 검증이다. `pnpm install`(prisma generate) 은 schema 파싱만 하므로 DATABASE_URL 없이도 성공한다.
  // 실제 DB 연결은 PrismaService 의 lazy connect 로 처리되므로, DB 가 일시적으로 다운돼도 앱 부팅은 통과하고 첫 쿼리 시점에서 에러가 드러난다.
  @IsString()
  @Matches(/^postgres(ql)?:\/\//, {
    message:
      'DATABASE_URL은 postgres:// 또는 postgresql:// 로 시작해야 합니다.',
  })
  DATABASE_URL!: string;

  // Slack 봇 토큰 (이대리 — Socket Mode). 3개 모두 설정된 경우에만 SlackService 가 기동된다.
  // 미설정 시 앱은 정상 부팅되며 Slack 관련 기능만 비활성화된다.
  @IsOptional()
  @IsString()
  SLACK_BOT_TOKEN?: string;

  @IsOptional()
  @IsString()
  SLACK_APP_TOKEN?: string;

  @IsOptional()
  @IsString()
  SLACK_SIGNING_SECRET?: string;
}

export const validateEnv = (config: Record<string, unknown>) => {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validated;
};
