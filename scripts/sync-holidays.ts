// 공휴일 동기화를 손으로 한 번 돌린다. 자율 작업(`holiday-sync`)은 주 1회 월요일 새벽에만
// 발화하므로, 키를 새로 넣었거나 임시공휴일이 지정된 직후처럼 그때까지 기다릴 수 없을 때 쓴다.
// 저장이 멱등이라(같은 날·같은 이름이면 건너뛰고, 사용자가 넣어 둔 줄은 승격) 여러 번 돌려도
// 줄이 쌓이지 않는다.
//
//   pnpm ts-node scripts/sync-holidays.ts            # 올해 + 내년
//   pnpm ts-node scripts/sync-holidays.ts 2026 2027  # 연도 지정
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { getTodayKstDate } from '../src/common/util/kst-date.util';
import { SyncKoreanHolidaysUsecase } from '../src/holiday/application/sync-korean-holidays.usecase';
import { HolidayModule } from '../src/holiday/holiday.module';
import { PrismaModule } from '../src/prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HolidayModule,
  ],
})
class HolidaySyncCliModule {}

const parseYears = (args: string[]): number[] => {
  const given = args
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value >= 2000);
  if (given.length > 0) {
    return given;
  }
  // 서버 timezone 이 UTC 면 `new Date().getFullYear()` 가 연말 하루 동안 지난 해를 가리킨다.
  const thisYear = Number(getTodayKstDate().slice(0, 4));
  return [thisYear, thisYear + 1];
};

const main = async (): Promise<void> => {
  const years = parseYears(process.argv.slice(2));
  const application = await NestFactory.createApplicationContext(
    HolidaySyncCliModule,
    { logger: ['error', 'warn', 'log'] },
  );
  try {
    const owner = application
      .get(ConfigService)
      .get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    if (!owner) {
      // 어느 사람의 달력에 넣을지 모르는 채로 저장할 수는 없다.
      throw new Error(
        'CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않아 공휴일을 넣을 대상을 알 수 없습니다.',
      );
    }
    const result = await application.get(SyncKoreanHolidaysUsecase).execute({
      slackUserId: owner,
      years,
    });
    if (result.skippedReason) {
      console.log(`건너뜀: ${result.skippedReason}`);
      return;
    }
    console.log(
      `완료 — 신규 ${result.created}건 · 승격 ${result.promoted}건 · 기존 ${result.alreadyPresent}건 (${result.years.join('·')}년)`,
    );
  } finally {
    await application.close();
  }
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
