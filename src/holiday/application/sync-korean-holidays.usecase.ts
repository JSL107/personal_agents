import { Inject, Injectable, Logger } from '@nestjs/common';

import { ListSchedulesUsecase } from '../../schedule/application/list-schedules.usecase';
import { MarkScheduleAsHolidayUsecase } from '../../schedule/application/mark-schedule-as-holiday.usecase';
import { RegisterScheduleUsecase } from '../../schedule/application/register-schedule.usecase';
import { plainDateToUtcDate } from '../../schedule/domain/parse-due-date';
import {
  PlainDate,
  ScheduleItemRecord,
} from '../../schedule/domain/schedule.type';
import { KoreanHoliday } from '../domain/holiday.type';
import {
  KOREAN_HOLIDAY_CLIENT_PORT,
  KoreanHolidayClientPort,
} from '../domain/port/korean-holiday.client.port';

const MONTHS_IN_YEAR = 12;

export interface SyncKoreanHolidaysInput {
  slackUserId: string;
  years: number[];
}

export interface SyncKoreanHolidaysResult {
  // 이번 회차에 새로 넣은 건수.
  created: number;
  // 이미 있어 건너뛴 건수. 두 번째 회차부터는 이 값이 대부분이고 `created` 가 0 인 것이
  // 정상이다 — 0 이라고 실패로 읽으면 안 된다.
  alreadyPresent: number;
  // 사용자가 손으로 넣어 둔 같은 날·같은 이름의 일정을 공휴일로 승격한 건수.
  promoted: number;
  years: number[];
  // 키가 없어 아무것도 하지 않았을 때의 사유. **null 이 정상** 이고, 값이 있으면 조회를
  // 시도조차 하지 않은 회차다 — 건수 0 만 보고 "올해 공휴일이 없다" 로 읽지 않게 가른다.
  skippedReason: string | null;
}

// 공휴일을 일반 일정과 같은 테이블에 넣는다. 화면에서 같은 칩으로 보이고 완료·건너뜀도
// 되는 것이 요구였고, 구별이 필요한 자리(달력 색·브리핑 제외)는 `isHoliday` 한 필드가 맡는다.
@Injectable()
export class SyncKoreanHolidaysUsecase {
  private readonly logger = new Logger(SyncKoreanHolidaysUsecase.name);

  constructor(
    @Inject(KOREAN_HOLIDAY_CLIENT_PORT)
    private readonly client: KoreanHolidayClientPort,
    private readonly listSchedules: ListSchedulesUsecase,
    private readonly registerSchedule: RegisterScheduleUsecase,
    private readonly markAsHoliday: MarkScheduleAsHolidayUsecase,
  ) {}

  async execute(
    input: SyncKoreanHolidaysInput,
  ): Promise<SyncKoreanHolidaysResult> {
    // 키가 없는 것은 오류가 아니라 "아직 붙이지 않았다" 이다. 예외로 끊으면 자율 작업이
    // 매주 실패 알람을 내고, 조용히 0건을 돌려주면 성공한 척한다 — 사유를 실어 돌려준다.
    if (!this.client.isConfigured()) {
      return {
        created: 0,
        alreadyPresent: 0,
        promoted: 0,
        years: [],
        skippedReason:
          'KOREAN_HOLIDAY_API_KEY 가 설정되지 않았습니다 (공공데이터포털 「특일 정보」 활용신청 후 .env 에 추가).',
      };
    }
    let created = 0;
    let alreadyPresent = 0;
    let promoted = 0;
    for (const year of input.years) {
      const holidays = await this.collectYear(year);
      const present = await this.presentByKey(input.slackUserId, year);
      for (const holiday of holidays) {
        const key = holidayKey(holiday.date, holiday.name);
        const found = present.get(key);
        if (found) {
          // **이미 있다고 그냥 넘기지 않는다.** 사용자가 손으로 넣어 둔 줄이면
          // `isHoliday` 가 false 라, 건너뛰는 순간 그 날은 달력에서 빨갛게 서지도
          // 아침 브리핑에서 빠지지도 않는다 — 그 날만 이 기능이 통째로 안 먹는다.
          if (found.isHoliday) {
            alreadyPresent += 1;
            continue;
          }
          await this.markAsHoliday.execute(found.id);
          present.set(key, { ...found, isHoliday: true });
          promoted += 1;
          continue;
        }
        const saved = await this.registerSchedule.execute({
          slackUserId: input.slackUserId,
          title: holiday.name,
          dueDate: holiday.date,
          isHoliday: true,
        });
        // 같은 회차 안에서 같은 날·같은 이름이 두 번 와도 두 줄이 되지 않게 바로 넣는다
        // (연휴를 월 경계로 나눠 주는 응답이 겹쳐 오는 경우를 봤다는 보고가 있다).
        present.set(key, saved);
        created += 1;
      }
    }
    this.logger.log(
      `공휴일 동기화: ${input.years.join('·')}년 — 신규 ${created}건, 승격 ${promoted}건, 기존 ${alreadyPresent}건`,
    );
    return {
      created,
      alreadyPresent,
      promoted,
      years: input.years,
      skippedReason: null,
    };
  }

  // 한 해를 12번 나눠 부른다. **한 달이라도 실패하면 그 해를 통째로 중단한다** — 절반만
  // 들어간 해는 "8월엔 광복절이 없다" 처럼 보이는데, 그건 빠진 것과 원래 없는 것이
  // 구분되지 않는 상태다. 주 1회 다시 도는 작업이고 저장이 멱등이라 다음 회차가 메운다.
  private async collectYear(year: number): Promise<KoreanHoliday[]> {
    const collected: KoreanHoliday[] = [];
    for (let month = 1; month <= MONTHS_IN_YEAR; month += 1) {
      // 순차로 부른다 — 공공 API 는 초당 호출 상한이 있고, 12건은 병렬로 아낄 만한 양이 아니다.
      collected.push(...(await this.client.fetchMonth(year, month)));
    }
    return collected;
  }

  // 그 해에 이미 있는 (날짜, 제목) → 그 줄. **공휴일만이 아니라 전부** 를 본다 — 사용자가
  // 손으로 "설날" 을 같은 날 등록해 뒀다면 그 위에 하나를 더 얹을 이유가 없고, 대신
  // 그 줄을 공휴일로 승격한다.
  private async presentByKey(
    slackUserId: string,
    year: number,
  ): Promise<Map<string, ScheduleItemRecord>> {
    const items = await this.listSchedules.execute({
      slackUserId,
      from: plainDateToUtcDate({ year, month: 1, day: 1 }),
      to: plainDateToUtcDate({ year, month: 12, day: 31 }),
    });
    const byKey = new Map<string, ScheduleItemRecord>();
    for (const item of items) {
      // `dueDate` 는 `@db.Date` 라 UTC 자정이다. 앞 10자가 곧 달력일이고, 로컬 타임존으로
      // 옮기면 하루가 밀린다(`ScheduleItem.dueDay` 와 같은 처리).
      const key = `${item.dueDate.toISOString().slice(0, 10)}|${item.title}`;
      // 같은 날 같은 제목이 이미 두 줄이면 **공휴일로 표시된 쪽을 남긴다** — 승격 대상을
      // 고를 때 이미 공휴일인 줄이 있는데 아닌 줄을 집으면 쓸데없이 한 번 더 쓴다.
      const kept = byKey.get(key);
      if (!kept || (!kept.isHoliday && item.isHoliday)) {
        byKey.set(key, item);
      }
    }
    return byKey;
  }
}

const holidayKey = (date: PlainDate, name: string): string => {
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}|${name}`;
};
