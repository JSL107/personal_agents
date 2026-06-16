import { Inject, Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  AddApplicationInput,
  JobApplicationRecord,
} from '../domain/job-application.type';
import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../domain/port/job-application.repository.port';

@Injectable()
export class AddApplicationUsecase {
  constructor(
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly repository: JobApplicationRepositoryPort,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute(
    input: AddApplicationInput,
  ): Promise<AgentRunOutcome<JobApplicationRecord>> {
    return this.agentRunService.execute<JobApplicationRecord>({
      agentType: AgentType.JOB_APPLICATION,
      triggerType: TriggerType.SLACK_MENTION_JOB_APPLICATION,
      inputSnapshot: {
        slackUserId: input.slackUserId,
        company: input.company,
        role: input.role,
        action: 'ADD',
      },
      run: async () => {
        const record = await this.repository.save({
          slackUserId: input.slackUserId,
          company: input.company,
          role: input.role,
          jdUrl: input.jdUrl,
          status: input.status ?? 'APPLIED',
          appliedAt: input.appliedAt,
          deadline: input.deadline,
        });
        return { result: record, modelUsed: 'deterministic', output: record };
      },
    });
  }
}
