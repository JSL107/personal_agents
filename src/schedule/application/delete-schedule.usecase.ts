import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  SCHEDULE_REPOSITORY_PORT,
  ScheduleRepositoryPort,
} from '../domain/port/schedule.repository.port';

export interface DeleteScheduleInput {
  id: number;
  // 변경과 같은 이유로 삭제에도 소유자 조건이 필요하다.
  slackUserId: string;
}

@Injectable()
export class DeleteScheduleUsecase {
  constructor(
    @Inject(SCHEDULE_REPOSITORY_PORT)
    private readonly repository: ScheduleRepositoryPort,
  ) {}

  async execute(input: DeleteScheduleInput): Promise<void> {
    const found = await this.repository.findById(input.id);
    // 남의 일정은 "없음" 으로 답한다(변경 경로와 동일).
    if (!found || found.slackUserId !== input.slackUserId) {
      throw new NotFoundException('해당 일정을 찾을 수 없습니다.');
    }
    await this.repository.deleteById(input.id);
  }
}
