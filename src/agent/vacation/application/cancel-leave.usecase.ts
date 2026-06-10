import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { computeBalance } from '../domain/balance-calculator';
import { PlainDate } from '../domain/plain-date';
import { MonthlyThenFixed15Policy } from '../domain/policy/accrual-policy';
import { VacationException } from '../domain/vacation.exception';
import { CancelLeaveResult } from '../domain/vacation.type';
import { VacationErrorCode } from '../domain/vacation-error-code.enum';
import { LeaveUsageRepository } from '../infrastructure/leave-usage.repository';
import { resolveHireDate } from './resolve-hire-date';

interface CancelLeaveCommand {
  slackUserId: string;
  usageId: number;
  asOf: PlainDate;
}

const policy = new MonthlyThenFixed15Policy();

@Injectable()
export class CancelLeaveUsecase {
  constructor(
    private readonly config: ConfigService,
    private readonly repository: LeaveUsageRepository,
    private readonly agentRunService: AgentRunService,
    // 테스트에서 시각 고정용 주입 (default: 실제 now). @Optional 로 Nest DI Function 오류 방지.
    @Optional() private readonly now: () => Date = () => new Date(),
  ) {}

  async execute({
    slackUserId,
    usageId,
    asOf,
  }: CancelLeaveCommand): Promise<AgentRunOutcome<CancelLeaveResult>> {
    const hireDate = resolveHireDate(this.config);

    return this.agentRunService.execute({
      agentType: AgentType.VACATION,
      triggerType: TriggerType.SLACK_COMMAND_VACATION,
      inputSnapshot: { slackUserId, action: 'CANCEL', usageId },
      evidence: [],
      run: async () => {
        const canceled = await this.repository.softCancel({
          slackUserId,
          usageId,
          canceledAt: this.now(),
        });
        if (!canceled) {
          throw new VacationException({
            code: VacationErrorCode.USAGE_NOT_FOUND,
            message: `취소할 휴가 기록(#${usageId})을 찾을 수 없습니다.`,
            status: DomainStatus.NOT_FOUND,
          });
        }
        const usages = await this.repository.findActiveByUser(slackUserId);
        const balance = computeBalance({ hireDate, asOf, policy, usages });
        const result: CancelLeaveResult = { canceledId: usageId, balance };
        return { result, modelUsed: 'deterministic', output: result };
      },
    });
  }
}
