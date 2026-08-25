import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  ApplyIntradayStopResult,
  ApplyIntradayStopUsecase,
  IntradayStopFill,
} from '../../../paper-trading/application/apply-intraday-stop.usecase';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';
import { formatQuantity, formatWon } from './paper-order-fill.autopilot-task';

interface PaperIntradayStopAudit {
  inspectedCount: number;
  lookupFailureCount: number;
  decidedCount: number;
  filledCount: number;
  skippedByPendingSell: number;
  skippedByNoPosition: number;
  accountFailureCount: number;
}

const buildAudit = (
  result: ApplyIntradayStopResult,
): PaperIntradayStopAudit => ({
  inspectedCount: result.inspectedCount,
  lookupFailureCount: result.lookupFailureCount,
  decidedCount: result.decidedCount,
  filledCount: result.filledCount,
  skippedByPendingSell: result.skippedByPendingSell,
  skippedByNoPosition: result.skippedByNoPosition,
  accountFailureCount: result.accountFailureCount,
});

const RETURN_RATE_FORMATTER = new Intl.NumberFormat('en-US', {
  signDisplay: 'always',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatReturnRate = (returnRatePercent: number): string =>
  `${RETURN_RATE_FORMATTER.format(returnRatePercent)}%`;

const formatFill = (fill: IntradayStopFill): string =>
  ` • [${fill.accountName}] ${fill.tickerCode} ` +
  `${escapeSlackMrkdwn(fill.tickerName)} ${formatQuantity(fill.quantity)}주 ` +
  `@ ${formatWon(fill.price)} (${formatReturnRate(fill.returnRatePercent)})`;

const formatUnfilled = (result: ApplyIntradayStopResult): string | null => {
  const unfilledCount = Math.max(result.decidedCount - result.filledCount, 0);
  if (unfilledCount === 0) {
    return null;
  }
  const unexplainedCount = Math.max(
    unfilledCount - result.skippedByPendingSell - result.skippedByNoPosition,
    0,
  );
  const reasons = [
    `기존 매도 주문 대기 ${result.skippedByPendingSell}건`,
    `보유 수량 없음 ${result.skippedByNoPosition}건`,
  ];
  if (unexplainedCount > 0) {
    reasons.push(`기타 체결 미완료 ${unexplainedCount}건`);
  }
  return ` • 손절 판정 후 미체결 ${unfilledCount}건 — ${reasons.join(' · ')}`;
};

const formatResult = (result: ApplyIntradayStopResult): AutopilotTaskResult => {
  if (result.window === 'BEFORE_OPEN') {
    return {
      skip: true,
      summaryText: '장중 손절 시간 창 이전 — 주문 미처리',
    };
  }
  if (result.window === 'AFTER_CLOSE') {
    return {
      skip: true,
      summaryText: '장중 손절 시간 창 종료 — 주문 미처리',
    };
  }
  // 장중 5분 주기라 "손절 0건" 을 매번 보내면 하루 70장이다. 알릴 것이 있을 때만 카드를 낸다.
  // 계좌 실패는 알릴 것에 포함된다 — 삼킨 예외를 조용한 정상 회차로 보이게 두지 않는다.
  //
  // 조회 실패는 두 가지가 같은 모양으로 나온다. 공휴일이면 어느 종목도 오늘 봉을 주지 않아
  // 전 종목이 실패로 잡히고, 그 회차를 알리면 휴장일마다 같은 카드가 70장 나간다. 반면
  // 일부만 실패한 회차는 진짜 부분 장애다. 판정에 성공한 종목이 하나도 없으면 휴장으로 보고
  // 넘기고, 그래도 집계는 audit(원장)에 남으므로 사후 추적은 막히지 않는다.
  const inspectedNone = result.inspectedCount === 0;
  if (
    result.filledCount === 0 &&
    result.decidedCount === 0 &&
    result.accountFailureCount === 0 &&
    (result.lookupFailureCount === 0 || inspectedNone)
  ) {
    return { skip: true };
  }

  const lines = [
    `*장중 손절* — ${result.filledCount}건 청산`,
    ...result.fills.map(formatFill),
  ];
  if (result.lookupFailureCount > 0) {
    lines.push(
      ` • 시세 조회 실패 ${result.lookupFailureCount}건 — 다음 회차에 다시 봅니다`,
    );
  }
  const unfilledLine = formatUnfilled(result);
  if (unfilledLine) {
    lines.push(unfilledLine);
  }
  if (result.accountFailureCount > 0) {
    lines.push(
      ` • 계좌 ${result.accountFailureCount}개는 처리 중 오류로 건너뛰었습니다 — 원장(agent_run)에서 확인이 필요합니다`,
    );
  }
  return { skip: false, summaryText: lines.join('\n') };
};

@Injectable()
export class PaperIntradayStopAutopilotTask implements AutopilotTask {
  readonly id = 'paper-intraday-stop';

  constructor(
    private readonly applyIntradayStop: ApplyIntradayStopUsecase,
    private readonly configService: ConfigService,
    private readonly agentRunService: AgentRunService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const enabled = this.configService.get<string>('PAPER_TRADING_ENABLED');
    if (enabled !== 'true') {
      return { skip: true };
    }

    const outcome = await this.agentRunService.execute<AutopilotTaskResult>({
      agentType: AgentType.PAPER_TRADE,
      triggerType: TriggerType.AUTOPILOT_PAPER_INTRADAY_STOP_CRON,
      inputSnapshot: {
        taskId: this.id,
        firedAtKst: context.firedAtKst,
      },
      run: async ({ agentRunId }) => {
        const result = await this.applyIntradayStop.execute({
          executedAt: new Date(),
          agentRunId,
        });
        return {
          result: formatResult(result),
          modelUsed: 'deterministic',
          output: buildAudit(result),
        };
      },
    });
    return outcome.result;
  }
}
