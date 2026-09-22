import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';
import {
  canTransition,
  ScheduleItemRecord,
  ScheduleStatus,
} from '../domain/schedule.type';

export interface UpdateScheduleStatusInput {
  id: number;
  status: ScheduleStatus;
  // 호출자가 자기 일정만 건드리게 하는 소유자 조건. 조회(GET)만 막고 변경을 열어 두면
  // 루프백에서 남의 행 id 를 찍어 완료·건너뜀 처리할 수 있다.
  slackUserId: string;
}

@Injectable()
export class UpdateScheduleStatusUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: UpdateScheduleStatusInput): Promise<ScheduleItemRecord> {
    const found = await this.repository.findById(input.id);
    // 남의 일정은 "없음" 으로 답한다. 403 으로 구분해 주면 그 id 가 존재한다는 사실이 샌다.
    if (!found || found.slackUserId !== input.slackUserId) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    if (!canTransition(found.status, input.status)) {
      // 404 가 아니라 409 다 — 항목은 있고 상태가 충돌한 것이다. 타입을 틀리면
      // 컨트롤러가 그대로 404 로 내보내 "없는 항목" 과 구분되지 않는다.
      throw new ConflictException('이미 같은 상태입니다.');
    }
    return await this.repository.updateStatus({
      id: input.id,
      status: input.status,
      completedAt: input.status === ScheduleStatus.DONE ? new Date() : null,
    });
  }
}
