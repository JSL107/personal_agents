import { Inject, Injectable } from '@nestjs/common';

import {
  JobApplicationRecord,
  ListApplicationsInput,
} from '../domain/job-application.type';
import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../domain/port/job-application.repository.port';

// 단순 조회라 AgentRun 라이프사이클 미사용 (부작용 없음 — VACATION ListUsage 동일).
@Injectable()
export class ListApplicationsUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly repository: JobApplicationRepositoryPort,
  ) {}

  async execute({
    slackUserId,
  }: ListApplicationsInput): Promise<JobApplicationRecord[]> {
    return this.repository.listByUser(slackUserId);
  }
}
