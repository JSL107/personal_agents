import { Injectable } from '@nestjs/common';

import { LeaveUsageRecord, ListUsageInput } from '../domain/vacation.type';
import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';

// 단순 조회라 AgentRun 라이프사이클 미사용 (audit 가치 낮음 — 부작용 없음).
@Injectable()
export class ListUsageUsecase {
  constructor(private readonly repository: LeaveUsageRepository) {}

  async execute({ slackUserId }: ListUsageInput): Promise<LeaveUsageRecord[]> {
    return this.repository.findActiveByUser(slackUserId);
  }
}
