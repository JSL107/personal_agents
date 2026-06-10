import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { computeBalance } from '../domain/balance-calculator';
import { countBusinessDays } from '../domain/business-day-counter';
import { PlainDate, plainDateToIso } from '../domain/plain-date';
import { MonthlyThenFixed15Policy } from '../domain/policy/accrual-policy';
import { RegisterLeaveResult } from '../domain/vacation.type';
import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';
import { resolveHireDate } from './resolve-hire-date';

interface RegisterLeaveCommand {
  slackUserId: string;
  startDate: PlainDate;
  endDate: PlainDate;
  memo?: string;
  asOf: PlainDate;
}

const policy = new MonthlyThenFixed15Policy();

@Injectable()
export class RegisterLeaveUsecase {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: LeaveUsageRepository,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    slackUserId,
    startDate,
    endDate,
    memo,
    asOf,
  }: RegisterLeaveCommand): Promise<AgentRunOutcome<RegisterLeaveResult>> {
    const hireDate = resolveHireDate(this.config);
    // 범위 역전 시 여기서 throw (저장 전).
    const businessDays = countBusinessDays(startDate, endDate);

    return this.agentRunService.execute({
      agentType: AgentType.VACATION,
      triggerType: TriggerType.SLACK_COMMAND_VACATION,
      inputSnapshot: {
        slackUserId,
        action: 'REGISTER',
        startDate: plainDateToIso(startDate),
        endDate: plainDateToIso(endDate),
        businessDays,
      },
      evidence: [],
      run: async () => {
        const registered = await this.repository.save({
          slackUserId,
          startDate,
          endDate,
          businessDays,
          memo,
        });
        const usages = await this.repository.findActiveByUser(slackUserId);
        const balance = computeBalance({ hireDate, asOf, policy, usages });
        const result: RegisterLeaveResult = { registered, balance };
        return { result, modelUsed: 'deterministic', output: result };
      },
    });
  }
}
