import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { plainDateToIso, todayInKst } from '../../vacation/domain/plain-date';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { ListApplicationsUsecase } from '../application/list-applications.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import {
  JOB_APPLICATION_PARSE_SYSTEM_PROMPT,
  parseJobApplicationIntent,
} from '../domain/prompt/job-application-parse.prompt';
import {
  formatAdded,
  formatApplicationList,
  formatUnknownJobApplication,
  formatUpdated,
} from './job-application.formatter';

@Injectable()
export class JobApplicationDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.JOB_APPLICATION;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly addApplication: AddApplicationUsecase,
    private readonly updateApplication: UpdateApplicationUsecase,
    private readonly listApplications: ListApplicationsUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const slackUserId = input.slackUserId;
    const today = todayInKst(new Date());
    const completion = await this.modelRouter.route({
      agentType: AgentType.JOB_APPLICATION,
      request: {
        prompt: `[오늘: ${plainDateToIso(today)}]\n${input.text ?? ''}`,
        systemPrompt: JOB_APPLICATION_PARSE_SYSTEM_PROMPT,
      },
    });
    const intent = parseJobApplicationIntent(completion.text);

    switch (intent.action) {
      case 'ADD': {
        const outcome = await this.addApplication.execute({
          slackUserId,
          company: intent.company!,
          role: intent.role!,
          jdUrl: intent.jdUrl,
          status: intent.status ?? 'APPLIED',
          appliedAt: today,
          deadline: intent.deadline,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatAdded(outcome.result),
        );
      }
      case 'UPDATE_STATUS': {
        const outcome = await this.updateApplication.execute({
          slackUserId,
          ref: intent.ref!,
          status: intent.status!,
          today,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatUpdated(outcome.result),
        );
      }
      case 'LIST': {
        const records = await this.listApplications.execute({ slackUserId });
        return this.toOutcome(0, records, formatApplicationList(records));
      }
      default:
        return this.toOutcome(
          0,
          { action: 'UNKNOWN' },
          formatUnknownJobApplication(),
        );
    }
  }

  private toOutcome(
    agentRunId: number,
    output: unknown,
    formattedText: string,
  ): DispatchOutcome {
    return { agentRunId, output, modelUsed: 'deterministic', formattedText };
  }
}
