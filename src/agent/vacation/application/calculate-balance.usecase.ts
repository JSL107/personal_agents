import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { computeBalance } from '../domain/balance-calculator';
import { PlainDate, plainDateToIso } from '../domain/plain-date';
import { MonthlyThenFixed15Policy } from '../domain/policy/accrual-policy';
import { VacationBalance } from '../domain/vacation.type';
import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';
import { resolveHireDate } from './resolve-hire-date';

interface CalculateBalanceCommand {
  slackUserId: string;
  asOf: PlainDate;
}

const policy = new MonthlyThenFixed15Policy();

@Injectable()
export class CalculateBalanceUsecase {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: LeaveUsageRepository,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    asOf,
  }: CalculateBalanceCommand): Promise<AgentRunOutcome<VacationBalance>> {
    const hireDate = resolveHireDate(this.config);
    const usages = await this.repository.findActiveByUser(slackUserId);

    return this.agentRunService.execute({
      agentType: AgentType.VACATION,
      triggerType: TriggerType.SLACK_COMMAND_VACATION,
      inputSnapshot: {
        slackUserId,
        action: 'BALANCE',
        asOf: plainDateToIso(asOf),
      },
      evidence: [],
      run: async () => {
        const balance = computeBalance({ hireDate, asOf, policy, usages });
        return { result: balance, modelUsed: 'deterministic', output: balance };
      },
    });
  }
}
