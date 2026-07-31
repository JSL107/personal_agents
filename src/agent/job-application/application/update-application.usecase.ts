import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { addDays, todayInKst } from '../../vacation/domain/plain-date';
import { JobApplicationException } from '../domain/job-application.exception';
import {
  FOLLOW_UP_INTERVAL_DAYS,
  JobApplicationRecord,
  TERMINAL_STATUSES,
  UpdateApplicationInput,
} from '../domain/job-application.type';
import { JobApplicationErrorCode } from '../domain/job-application-error-code.enum';
import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../domain/port/job-application.repository.port';

@Injectable()
export class UpdateApplicationUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly repository: JobApplicationRepositoryPort,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    ref,
    status,
  }: UpdateApplicationInput): Promise<AgentRunOutcome<JobApplicationRecord>> {
    return this.agentRunService.execute<JobApplicationRecord>({
      agentType: AgentType.JOB_APPLICATION,
      triggerType: TriggerType.SLACK_MENTION_JOB_APPLICATION,
      inputSnapshot: { slackUserId, ref, status, action: 'UPDATE_STATUS' },
      run: async () => {
        // 활동(상태 변경)이 있었으니 팔로업 시계를 리셋한다. 종료 상태면 더는 넛지하지 않으므로 null.
        const nextFollowUpAt = TERMINAL_STATUSES.includes(status)
          ? null
          : addDays(todayInKst(new Date()), FOLLOW_UP_INTERVAL_DAYS);
        const updated = await this.repository.updateStatusByCompany({
          slackUserId,
          companyRef: ref,
          status,
          nextFollowUpAt,
        });
        if (!updated) {
          throw new JobApplicationException({
            code: JobApplicationErrorCode.NOT_FOUND,
            message: `"${ref}" 에 해당하는 진행 중 지원 건을 찾지 못했습니다.`,
            status: DomainStatus.NOT_FOUND,
          });
        }
        return {
          result: updated,
          modelUsed: 'deterministic',
          output: updated,
        };
      },
    });
  }
}
