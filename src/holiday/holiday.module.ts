import { Module } from '@nestjs/common';

import { ScheduleModule } from '../schedule/schedule.module';
import { SyncKoreanHolidaysUsecase } from './application/sync-korean-holidays.usecase';
import { KOREAN_HOLIDAY_CLIENT_PORT } from './domain/port/korean-holiday.client.port';
import { KoreanHolidayApiClient } from './infrastructure/korean-holiday.api-client';

// 공휴일 수집만 한다. 저장은 `ScheduleModule` 의 등록 usecase 를 그대로 쓴다 —
// 같은 테이블에 두 개의 저장 경로가 생기면 규칙(상태 기본값·필드 기본값)이 갈린다.
@Module({
  imports: [ScheduleModule],
  providers: [
    { provide: KOREAN_HOLIDAY_CLIENT_PORT, useClass: KoreanHolidayApiClient },
    SyncKoreanHolidaysUsecase,
  ],
  exports: [SyncKoreanHolidaysUsecase],
})
export class HolidayModule {}
