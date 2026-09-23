import { Injectable, Logger } from '@nestjs/common';

import { SyncKoreanHolidaysUsecase } from '../../../holiday/application/sync-korean-holidays.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 올해와 내년을 함께 넣는다. 올해만 넣으면 12월에 다음 해 달력이 통째로 비고, 그 사실은
// 12월이 되어서야 드러난다 — 매주 도는 작업이 한 해의 마지막 주에만 틀리는 셈이다.
const YEARS_AHEAD = 1;

// 주 1회 한국 공휴일 동기화. 공휴일은 연초에 확정되지만 임시공휴일이 중간에 생기므로
// 한 번 넣고 끝내지 않는다. 저장이 멱등이라(같은 날·같은 이름이면 건너뜀) 매주 돌아도
// 줄이 쌓이지 않는다.
@Injectable()
export class HolidaySyncAutopilotTask implements AutopilotTask {
  readonly id = 'holiday-sync';

  private readonly logger = new Logger(HolidaySyncAutopilotTask.name);

  constructor(private readonly syncHolidays: SyncKoreanHolidaysUsecase) {}

  async run({
    firedAtKst,
    ownerSlackUserId,
  }: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    // `firedAtKst` 는 `YYYY-MM-DD`(`getTodayKstDate`). 연도만 떼어 쓴다 — 서버 timezone 이
    // UTC 면 `new Date().getFullYear()` 가 연말 하루 동안 지난 해를 가리킨다.
    const thisYear = Number(firedAtKst.slice(0, 4));
    const years = [thisYear, thisYear + YEARS_AHEAD];
    const result = await this.syncHolidays.execute({
      slackUserId: ownerSlackUserId,
      years,
    });

    if (result.skippedReason) {
      // 키를 아직 안 붙인 것은 고장이 아니다. 매주 같은 알림을 보내면 정작 봐야 할 카드가
      // 그 소음에 묻히므로 로그로만 남긴다 — 달력에 공휴일이 안 보일 때 여기가 단서다.
      this.logger.warn(`공휴일 동기화를 건너뜁니다: ${result.skippedReason}`);
      return { skip: true };
    }
    const changed = result.created + result.promoted;
    if (changed === 0) {
      // 두 번째 회차부터는 이것이 정상이다. 「신규 0건」 을 매주 보낼 이유가 없다.
      return { skip: true };
    }
    // 승격(사용자가 손으로 넣어 둔 줄을 공휴일로 바꾼 것)은 남의 줄을 고친 것이라 건수를
    // 따로 밝힌다 — 뭉뚱그리면 새로 넣은 것과 구분되지 않는다.
    const promotedNote =
      result.promoted > 0 ? ` (기존 일정 ${result.promoted}건 승격 포함)` : '';
    return {
      skip: false,
      summaryText: `🗓️ 공휴일 ${changed}건을 달력에 반영했습니다 (${years.join('·')}년)${promotedNote}.`,
    };
  }
}
