import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import {
  formatBalance,
  formatCanceled,
  formatInvalidCommand,
  formatRegistered,
  formatUsageList,
} from '../../../slack/format/vacation.formatter';
import { CalculateBalanceUsecase } from '../application/calculate-balance.usecase';
import { CancelLeaveUsecase } from '../application/cancel-leave.usecase';
import { ListUsageUsecase } from '../application/list-usage.usecase';
import { RegisterLeaveUsecase } from '../application/register-leave.usecase';
import { plainDateToIso, todayInKst } from '../domain/plain-date';
import {
  parseNlVacationIntent,
  VACATION_PARSE_SYSTEM_PROMPT,
} from '../domain/prompt/vacation-parse.prompt';

@Injectable()
export class VacationDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.VACATION;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly calculateBalance: CalculateBalanceUsecase,
    private readonly registerLeave: RegisterLeaveUsecase,
    private readonly listUsage: ListUsageUsecase,
    private readonly cancelLeave: CancelLeaveUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const asOf = todayInKst(new Date());
    const slackUserId = input.slackUserId;
    const completion = await this.modelRouter.route({
      agentType: AgentType.VACATION,
      request: {
        prompt: `[오늘: ${plainDateToIso(asOf)}]\n${input.text ?? ''}`,
        systemPrompt: VACATION_PARSE_SYSTEM_PROMPT,
      },
    });
    const intent = parseNlVacationIntent(completion.text);

    switch (intent.action) {
      case 'REGISTER': {
        const outcome = await this.registerLeave.execute({
          slackUserId,
          startDate: intent.startDate!,
          endDate: intent.endDate!,
          memo: intent.memo,
          asOf,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatRegistered(outcome.result),
        );
      }
      case 'LIST': {
        const records = await this.listUsage.execute({ slackUserId });
        return this.toOutcome(0, records, formatUsageList(records));
      }
      case 'CANCEL': {
        const outcome = await this.cancelLeave.execute({
          slackUserId,
          usageId: intent.usageId!,
          asOf,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatCanceled(outcome.result),
        );
      }
      case 'BALANCE': {
        const outcome = await this.calculateBalance.execute({
          slackUserId,
          asOf,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatBalance(outcome.result),
        );
      }
      default:
        return this.toOutcome(0, { action: 'UNKNOWN' }, formatInvalidCommand());
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
