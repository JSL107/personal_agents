import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

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
    // 공휴일 행은 영업일 달력의 정본이다(`holiday-calendar.prisma.reader.ts`). 지우면 다음
    // 주간 동기화까지 그 날이 거래일·근무일로 계산돼 주문 목표일·결제일·휴가 일수가 틀린다.
    // 달력에서 치우고 싶으면 완료·건너뜀으로 상태만 바꾼다 — 달력은 상태를 보지 않는다.
    if (found.isHoliday) {
      throw new BadRequestException(
        '공휴일은 삭제할 수 없습니다. 완료 또는 건너뜀으로 처리해 주세요.',
      );
    }
    await this.repository.deleteById(input.id);
  }
}
