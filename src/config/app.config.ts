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

  // GitHub Personal Access Token. 미설정 시 GitHub 커넥터 호출 시점에 친절한 예외로 빠진다 (앱 부팅엔 영향 없음).
  @IsOptional()
  @IsString()
  GITHUB_TOKEN?: string;

  // Notion integration token + 조회할 task DB ID 콤마 구분 리스트.
  // 미설정 시 Notion 커넥터 호출 시 친절한 예외 (앱 부팅엔 영향 없음).
  @IsOptional()
  @IsString()
  NOTION_TOKEN?: string;

  @IsOptional()
  @IsString()
  NOTION_TASK_DB_IDS?: string;

  // Daily Plan write back 용 별도 DB (선택). 미설정 시 NOTION_TASK_DB_IDS 첫 번째 DB 를 재사용.
  @IsOptional()
  @IsString()
  NOTION_DAILY_PLAN_DATABASE_ID?: string;

  // PRO-1 Morning Briefing CRON 설정.
  // - OWNER_SLACK_USER_ID: PM 컨텍스트의 "누구의 plan 인지" 식별자 (GitHub assigned / Slack 멘션 fetch 기준).
  //   미설정 = 모듈 자동 비활성화 (graceful, 1인 봇이라 단일 owner).
  // - DELIVERY_TARGETS: 콤마 구분 발송 대상 — 슬랙 user ID(U...) 또는 채널 ID(C.../G...) 혼용.
  //   빈 값이면 OWNER 의 DM 으로 발송. private 채널은 봇 invite 필요.
  // - CRON: BullMQ repeatable cron pattern (default: 매일 08:30).
  // - TIMEZONE: cron 해석 기준 (default: Asia/Seoul).
  @IsOptional()
  @IsString()
  MORNING_BRIEFING_OWNER_SLACK_USER_ID?: string;

  @IsOptional()
  @IsString()
  MORNING_BRIEFING_DELIVERY_TARGETS?: string;

  @IsOptional()
  @IsString()
  MORNING_BRIEFING_CRON?: string;

  @IsOptional()
  @IsString()
  MORNING_BRIEFING_TIMEZONE?: string;

  // OPS-6 stale data filter — GitHub assigned issue / Notion task DB 의 컷오프 (일 단위).
  // 미설정 시 default 60일. 사용자가 archive 안 한 long-tail 데이터가 매일 prompt 에 누적되는 것을 차단.
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, {
    message: 'STALE_DATA_CUTOFF_DAYS 는 양의 정수 (예: "60") 만 허용합니다.',
  })
  STALE_DATA_CUTOFF_DAYS?: string;
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
