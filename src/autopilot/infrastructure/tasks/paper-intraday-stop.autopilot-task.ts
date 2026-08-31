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
import { formatQuantity, formatWon } from '../paper-number.formatter';

interface PaperIntradayStopAudit {
  inspectedCount: number;
  priceErrorCount: number;
  notTradedCount: number;
  corporateActionCount: number;
  corporateActions: string[];
  decidedCount: number;
  filledCount: number;
  fillFailureCount: number;
  skippedByPendingSell: number;
  skippedByNoPosition: number;
  accountFailureCount: number;
  accountFailures: ApplyIntradayStopResult['accountFailures'];
}

const buildAudit = (
  result: ApplyIntradayStopResult,
): PaperIntradayStopAudit => ({
  inspectedCount: result.inspectedCount,
  priceErrorCount: result.priceErrorCount,
  notTradedCount: result.notTradedCount,
  corporateActionCount: result.corporateActionCount,
  corporateActions: result.corporateActions,
  decidedCount: result.decidedCount,
  filledCount: result.filledCount,
  fillFailureCount: result.fillFailureCount,
  skippedByPendingSell: result.skippedByPendingSell,
  skippedByNoPosition: result.skippedByNoPosition,
  accountFailureCount: result.accountFailureCount,
  // 건수만 남기면 Slack 이 "원장을 보라" 고 안내해도 원장에 숫자밖에 없다.
  accountFailures: result.accountFailures,
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
  //
  // 조용히 넘기는 것은 **휴장뿐**이다. 휴장이면 어느 종목도 오늘 봉을 주지 않아 전 종목이
  // `notTraded` 로 잡히는데, 그 회차를 알리면 휴장일마다 같은 카드가 70장 나간다.
  // 반면 시세 조회가 예외로 끊긴 것(`priceError`)은 공급자 장애 신호이고, 그때는 손절
  // 보호가 통째로 멈춘 상태다 — 조용히 넘기면 그 사실이 아무에게도 안 알려진다.
  // 계좌 실패와 체결 실패도 같은 이유로 알린다.
  const holidayLike =
    result.priceErrorCount === 0 &&
    result.inspectedCount === 0 &&
    result.corporateActionCount === 0;
  if (
    result.filledCount === 0 &&
    result.decidedCount === 0 &&
    result.accountFailureCount === 0 &&
    result.fillFailureCount === 0 &&
    result.corporateActionCount === 0 &&
    (holidayLike ||
      (result.priceErrorCount === 0 && result.notTradedCount === 0))
  ) {
    return { skip: true };
  }

  const lines = [
    `*장중 손절* — ${result.filledCount}건 청산`,
    ...result.fills.map(formatFill),
  ];
  if (result.priceErrorCount > 0) {
    lines.push(
      ` • 시세 조회 실패 ${result.priceErrorCount}건 — 시세 공급자 쪽 문제일 수 있습니다. 그 종목은 이번 회차에 손절 판정을 받지 못했습니다`,
    );
  }
  if (result.notTradedCount > 0 && result.inspectedCount > 0) {
    lines.push(
      ` • 오늘 거래가 없는 종목 ${result.notTradedCount}건 — 거래정지 여부를 확인해 주세요`,
    );
  }
  if (result.corporateActions.length > 0) {
    lines.push(
      ` • 기업행동 의심으로 손절 판정 보류 ${result.corporateActionCount}건 — ` +
        `그 종목은 이번 회차에 청산되지 않았습니다. 배당락이면 받을 배당금이, ` +
        `분할이면 늘어난 수량이 장부에 아직 없으니 확인이 필요합니다`,
      ...result.corporateActions.map(
        (description) => `   - ${escapeSlackMrkdwn(description)}`,
      ),
    );
  }
  if (result.fillFailureCount > 0) {
    lines.push(
      ` • 손절 주문을 만들었으나 체결하지 못해 되돌림 ${result.fillFailureCount}건 — 다음 회차가 새 현재가로 다시 판정합니다`,
    );
  }
  const unfilledLine = formatUnfilled(result);
  if (unfilledLine) {
    lines.push(unfilledLine);
  }
  if (result.accountFailures.length > 0) {
    lines.push(
      ` • 계좌 ${result.accountFailureCount}개는 처리 중 오류로 건너뛰었습니다 — ${result.accountFailures
        .map(
          (failure) =>
            `${failure.accountName}: ${escapeSlackMrkdwn(failure.reason)}`,
        )
        .join(' / ')}`,
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
