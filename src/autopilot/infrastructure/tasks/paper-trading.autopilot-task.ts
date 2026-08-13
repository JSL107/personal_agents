import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  EvaluateAllAccountsResult,
  EvaluatedAccountEntry,
  EvaluatePaperAccountUsecase,
} from '../../../paper-trading/application/evaluate-paper-account.usecase';
import { formatPaperTradingReport } from '../../../paper-trading/infrastructure/paper-trading.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

interface PaperTradingAccountAudit {
  accountName: string;
  positionCount: number | null;
  staleTickerCount: number | null;
  invariantViolationCount: number | null;
  suspiciousJumpCount: number | null;
  tradeDate: string | null;
  skipped: boolean | null;
  skipReason: string | null;
  failureReason: string | null;
}

interface PaperTradingAudit {
  accountCount: number;
  failedCount: number;
  accounts: PaperTradingAccountAudit[];
}

const buildAccountAudit = (
  entry: EvaluatedAccountEntry,
): PaperTradingAccountAudit => {
  const { evaluation } = entry;
  if (!evaluation) {
    return {
      accountName: entry.accountName,
      positionCount: null,
      staleTickerCount: null,
      invariantViolationCount: null,
      suspiciousJumpCount: null,
      tradeDate: null,
      skipped: null,
      skipReason: null,
      failureReason: entry.failureReason,
    };
  }
  return {
    accountName: entry.accountName,
    positionCount: evaluation.positionCount,
    staleTickerCount: evaluation.staleTickerCount,
    invariantViolationCount: evaluation.invariantViolations.length,
    suspiciousJumpCount: evaluation.suspiciousJumps.length,
    tradeDate: evaluation.tradeDate,
    skipped: evaluation.skipped,
    skipReason: evaluation.skipReason ?? null,
    failureReason: null,
  };
};

const buildAudit = (result: EvaluateAllAccountsResult): PaperTradingAudit => ({
  accountCount: result.accounts.length,
  failedCount: result.accounts.filter((entry) => !entry.evaluation).length,
  accounts: result.accounts.map(buildAccountAudit),
});

// 계좌가 여러 개면 어느 계좌의 평가인지가 리포트에서 드러나야 한다. 포매터는 계좌 이름을
// 모르므로(단일 계좌 시절 시그니처) 계좌 이름을 섹션 제목으로 앞에 붙인다.
const buildSummaryText = (result: EvaluateAllAccountsResult): string => {
  if (result.accounts.length === 0) {
    return (
      '*가상 매매 장마감 평가*\n\n' +
      '⚠️ 평가할 가상 계좌가 없습니다 — 추천(PAPER_RECOMMEND)이 계좌를 열기 전이거나 계좌가 삭제되었습니다.'
    );
  }
  return result.accounts
    .map((entry) => {
      const heading = `*[${entry.accountName}]*`;
      if (!entry.evaluation) {
        return `${heading}\n⚠️ 평가 실패 — ${entry.failureReason ?? '사유 미상'}`;
      }
      return `${heading}\n${formatPaperTradingReport(entry.evaluation)}`;
    })
    .join('\n\n');
};

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
        const evaluations = await this.evaluatePaperAccount.executeAll(
          // firedAtKst는 오케스트레이터가 고정한 KST 날짜다. 17:40 KST 시각으로 바꿔
          // 재시도 시각이 자정을 넘어도 원래 슬롯의 거래일을 평가하게 한다.
          new Date(`${context.firedAtKst}T08:40:00.000Z`),
        );
        // 한 계좌라도 실패하면 그 계좌의 그날 스냅샷은 비어 있고, 스냅샷은 거래일 단위라
        // 다음 슬롯이 메워주지 못한다(3-B 채점이 시계열로 수익률·낙폭을 계산한다).
        // 성공으로 반환하면 슬롯이 완주 처리되어 BullMQ 재시도(attempts, autopilot.scheduler.ts)
        // 가 돌지 않으므로, 부분 실패도 실패로 올려 재시도 대상으로 남긴다.
        // 재평가는 안전하다 — 스냅샷 적재가 거래일 기준 upsert 라 성공했던 계좌를 다시 평가해도
        // 같은 행을 덮어쓴다. 계좌별 격리(executeAll)는 유지되므로 한 계좌의 예외가 나머지
        // 계좌의 평가·적재를 막지는 않는다.
        const failedEntries = evaluations.accounts.filter(
          (entry) => !entry.evaluation,
        );
        if (failedEntries.length > 0) {
          const detail = failedEntries
            .map(
              (entry) =>
                `${entry.accountName}: ${entry.failureReason ?? '사유 미상'}`,
            )
            .join(' / ');
          const evaluatedNames = evaluations.accounts
            .filter((entry) => entry.evaluation)
            .map((entry) => entry.accountName);
          const evaluatedText =
            evaluatedNames.length > 0
              ? ` (평가 완료: ${evaluatedNames.join(', ')})`
              : '';
          throw new Error(
            `가상 계좌 ${evaluations.accounts.length}개 중 ${failedEntries.length}개를 평가하지 못했습니다 — ${detail}${evaluatedText}`,
          );
        }
        const taskResult: AutopilotTaskResult = {
          skip: false,
          summaryText: buildSummaryText(evaluations),
        };
        return {
          result: taskResult,
          modelUsed: 'deterministic',
          output: buildAudit(evaluations),
        };
      },
    });
    return outcome.result;
  }
}
