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
}

@Injectable()
export class UpdateScheduleStatusUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: UpdateScheduleStatusInput): Promise<ScheduleItemRecord> {
    const found = await this.repository.findById(input.id);
    if (!found) {
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
