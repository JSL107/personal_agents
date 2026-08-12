import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  EvaluateAccountResult,
  EvaluatePaperAccountUsecase,
} from '../../../paper-trading/application/evaluate-paper-account.usecase';
import { formatPaperTradingReport } from '../../../paper-trading/infrastructure/paper-trading.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

interface PaperTradingAudit {
  positionCount: number;
  staleTickerCount: number;
  invariantViolationCount: number;
  suspiciousJumpCount: number;
  tradeDate: string | null;
  skipped: boolean;
  skipReason: string | null;
}

const buildAudit = (evaluation: EvaluateAccountResult): PaperTradingAudit => ({
  positionCount: evaluation.positionCount,
  staleTickerCount: evaluation.staleTickerCount,
  invariantViolationCount: evaluation.invariantViolations.length,
  suspiciousJumpCount: evaluation.suspiciousJumps.length,
  tradeDate: evaluation.tradeDate,
  skipped: evaluation.skipped,
  skipReason: evaluation.skipReason ?? null,
});

@Injectable()
export class PaperTradingAutopilotTask implements AutopilotTask {
  readonly id = 'paper-trading';

  constructor(
    private readonly evaluatePaperAccount: EvaluatePaperAccountUsecase,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('PAPER_TRADING_ENABLED');
    // 의도적으로 꺼둔 실행은 실패율 통계를 오염시키지 않도록 원장 밖에서 막는다.
    if (enabled !== 'true') {
      return { skip: true };
    }

    const outcome = await this.agentRunService.execute<AutopilotTaskResult>({
      agentType: AgentType.PAPER_TRADE,
      triggerType: TriggerType.AUTOPILOT_PAPER_TRADING_CRON,
      inputSnapshot: {
        taskId: this.id,
        firedAtKst: context.firedAtKst,
      },
      run: async () => {
        const evaluation = await this.evaluatePaperAccount.execute({
          accountName: 'DEFAULT',
          // firedAtKst는 오케스트레이터가 고정한 KST 날짜다. 17:40 KST 시각으로 바꿔
          // 재시도 시각이 자정을 넘어도 원래 슬롯의 거래일을 평가하게 한다.
          executedAt: new Date(`${context.firedAtKst}T08:40:00.000Z`),
        });
        const taskResult: AutopilotTaskResult = {
          skip: false,
          summaryText: formatPaperTradingReport(evaluation),
        };
        return {
          result: taskResult,
          modelUsed: 'deterministic',
          output: buildAudit(evaluation),
        };
      },
    });
    return outcome.result;
  }
}
