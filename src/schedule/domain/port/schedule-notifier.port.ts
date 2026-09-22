import { ScheduleItemRecord } from '../schedule.type';

export const SCHEDULE_NOTIFIER_PORT = Symbol('SCHEDULE_NOTIFIER_PORT');

/**
 * 등록 결과를 사람에게 알리는 통로.
 *
 * 포트를 두는 이유는 구현을 갈아 끼우기 위해서가 아니라 **의존 방향** 때문이다. 이 계약이
 * 없으면 등록을 조율하는 application 이 발송 구현(infrastructure)을 직접 붙들게 되고,
 * 그건 안쪽에서 바깥을 가리키는 방향이다(`CODE_RULES.md` §7).
 *
 * **발송 실패로 throw 하지 않는다는 것이 계약의 일부다.** 이 알림은 등록의 결과 통지이지
 * 등록의 일부가 아니라서, 여기서 예외가 새어 나가면 이미 저장된 일정에 대해 호출부가 실패를
 * 돌려주고 사용자는 같은 일정을 다시 넣는다. 구현은 실패를 삼키고 로그만 남긴다.
 */
export interface ScheduleNotifierPort {
  notifyRegistered(record: ScheduleItemRecord): Promise<void>;
}
