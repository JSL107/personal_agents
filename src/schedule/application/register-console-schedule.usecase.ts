import { Inject, Injectable } from '@nestjs/common';

import {
  SCHEDULE_NOTIFIER_PORT,
  ScheduleNotifierPort,
} from '../domain/port/schedule-notifier.port';
import { ScheduleItemRecord } from '../domain/schedule.type';
import {
  RegisterScheduleInput,
  RegisterScheduleUsecase,
} from './register-schedule.usecase';

/**
 * 콘솔 캘린더에서 들어온 등록 — 저장한 뒤 Slack 으로 알린다.
 *
 * **`RegisterScheduleUsecase` 에 알림을 넣지 않고 감싸는 이유가 있다.** 그 usecase 는 Slack
 * 발화 경로(`ScheduleDispatcher`)도 함께 쓰는데, 거기서는 Router 가 이미 같은 채널로 답을
 * 보낸다 — 안쪽에 알림을 두면 Slack 으로 등록한 사람이 같은 내용을 두 번 받는다.
 *
 * 조율이 컨트롤러가 아니라 여기 있는 것은 "무엇을 저장하고 무엇을 알리는가" 가 application 의
 * 흐름이기 때문이다. 컨트롤러는 HTTP 입력을 이 입력 형태로 옮기는 데까지만 관여한다.
 */
@Injectable()
export class RegisterConsoleScheduleUsecase {
  constructor(
    private readonly registerSchedule: RegisterScheduleUsecase,
    @Inject(SCHEDULE_NOTIFIER_PORT)
    private readonly notifier: ScheduleNotifierPort,
  ) {}

  async execute(input: RegisterScheduleInput): Promise<ScheduleItemRecord> {
    const record = await this.registerSchedule.execute(input);
    // 발송 실패는 포트 계약상 삼켜진다(그 주석 참조). `await` 하는 것은 순서를 결정적으로
    // 두기 위해서다 — 버려 두면 응답이 먼저 나가고 알림은 다음 회차에 뜨거나 안 뜨는데,
    // 어느 쪽인지 밖에서 알 수 없다.
    await this.notifier.notifyRegistered(record);
    return record;
  }
}
