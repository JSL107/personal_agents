import { Injectable } from '@nestjs/common';

import {
  GeneratePaperRecommendationResult,
  GeneratePaperRecommendationUsecase,
  PaperRecommendationFailure,
  PaperRecommendationOrderDetail,
  PaperRecommendationSuccess,
} from '../../../agent/paper-recommend/application/generate-paper-recommendation.usecase';
import {
  PaperRecommendationSkipReason,
  PaperRecommendationStrategy,
} from '../../../agent/paper-recommend/domain/paper-recommendation.type';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const STRATEGIES: PaperRecommendationStrategy[] = ['LONG_TERM', 'SWING'];
const STRATEGY_LABELS: Record<PaperRecommendationStrategy, string> = {
  LONG_TERM: '장기',
  SWING: '스윙',
};
const SKIP_REASON_LABELS: Record<PaperRecommendationSkipReason, string> = {
  ALREADY_HELD: '보유 중·중복',
  NOT_IN_CANDIDATES: '후보 이탈',
  ZERO_WEIGHT: '비중 0',
  INSUFFICIENT_CASH: '현금 부족',
  BUY_LIMIT_REACHED: '매수 상한 초과',
  NOT_HELD: '보유 없음',
};

const formatResult = (
  result: GeneratePaperRecommendationResult,
): AutopilotTaskResult => {
  const completedByStrategy = new Map(
    result.completed.map((completed) => [completed.strategy, completed]),
  );
  const failedByStrategy = new Map(
    result.failed.map((failure) => [failure.strategy, failure]),
  );
  const presentStrategies = STRATEGIES.filter(
    (strategy) =>
      completedByStrategy.has(strategy) || failedByStrategy.has(strategy),
  );
  const headline = presentStrategies
    .map((strategy) => {
      const completed = completedByStrategy.get(strategy);
      return completed
        ? `${STRATEGY_LABELS[strategy]} ${completed.ordersCreated}건`
        : `${STRATEGY_LABELS[strategy]} 실패`;
    })
    .join(' · ');
  const summarySections = presentStrategies.map((strategy) => {
    const completed = completedByStrategy.get(strategy);
    if (completed) {
      return formatCompletedSummary(completed);
    }
    return formatFailureSummary(failedByStrategy.get(strategy)!);
  });
  const detailSections = presentStrategies.map((strategy) => {
    const completed = completedByStrategy.get(strategy);
    if (completed) {
      return formatCompletedDetail(completed);
    }
    return formatFailureDetail(failedByStrategy.get(strategy)!);
  });

  return {
    skip: false,
    summaryText: [`*모의투자 추천* — ${headline}`, ...summarySections].join(
      '\n',
    ),
    detailText: detailSections.join('\n\n'),
  };
};

const formatCompletedSummary = (
  completed: PaperRecommendationSuccess,
): string => {
  const buyCount = completed.orders.filter(
    (order) => order.side === 'BUY',
  ).length;
  const sellCount = completed.orders.length - buyCount;
  const accountText = formatAccount(completed);
  const header = completed.orders.length
    ? `*${STRATEGY_LABELS[completed.strategy]}* 매수 ${buyCount} · ` +
      `매도 ${sellCount} | ${accountText}`
    : `*${STRATEGY_LABELS[completed.strategy]}* 주문 없음 | ${accountText}`;
  const lines = [header, ...completed.orders.map(formatOrderLine)];
  if (completed.skipped.length > 0) {
    lines.push(formatSkipSummary(completed));
  } else if (completed.orders.length === 0) {
    lines.push(emptyReasonLine(completed));
  }
  return lines.join('\n');
};

const formatCompletedDetail = (
  completed: PaperRecommendationSuccess,
): string => {
  const lines = [
    `*${STRATEGY_LABELS[completed.strategy]} 상세*`,
    `계좌: ${formatAccount(completed)}`,
  ];
  for (const order of completed.orders) {
    lines.push(formatOrderLine(order), `   판단: ${order.reason}`);
  }
  for (const skip of completed.skipped) {
    lines.push(
      ` • 제외 ${sideLabel(skip.side)} ${skip.name}(${skip.code}) — ` +
        SKIP_REASON_LABELS[skip.reason],
    );
  }
  if (completed.orders.length === 0 && completed.skipped.length === 0) {
    lines.push(emptyReasonLine(completed));
  }
  return lines.join('\n');
};

// 주문이 0건인 이유를 '모델이 아무것도 안 골랐다' 와 '시세가 없어 만들지 못했다' 로 가른다.
const emptyReasonLine = (completed: PaperRecommendationSuccess): string => {
  if (completed.dataAsOf === null) {
    return ' • 시세 데이터 없음 — 주문 생성 안 됨';
  }
  return ' • 매수·매도 추천 없음';
};

const formatAccount = (completed: PaperRecommendationSuccess): string =>
  `현금 ${formatMoney(completed.account.cashBalance)} · ` +
  `보유 ${completed.account.positionCount}종목 · ` +
  `평가 ${formatMoney(completed.account.totalValue)}` +
  formatReturnRate(completed.account.returnRate);

// 평가 스냅샷이 없으면(첫 회차) 수익률 자리를 비운다.
const formatReturnRate = (returnRate: number | null): string => {
  if (typeof returnRate !== 'number' || !Number.isFinite(returnRate)) {
    return '';
  }
  const sign = returnRate >= 0 ? '+' : '';
  return `(${sign}${returnRate.toFixed(2)}%)`;
};

const formatFailureSummary = (failure: PaperRecommendationFailure): string =>
  `*${STRATEGY_LABELS[failure.strategy]}* 실패 — ${firstLineOf(failure.message)}`;

const formatFailureDetail = (failure: PaperRecommendationFailure): string =>
  `*${STRATEGY_LABELS[failure.strategy]} 실패 상세*\n${failure.message}`;

const formatOrderLine = (order: PaperRecommendationOrderDetail): string =>
  ` • ${sideLabel(order.side)} ${order.name}(${order.code}) ` +
  `${order.quantity}주 ≈ ${formatMoney(order.estimatedAmount)}`;

const formatSkipSummary = (completed: PaperRecommendationSuccess): string => {
  const counts = new Map<PaperRecommendationSkipReason, number>();
  for (const skip of completed.skipped) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  const reasonText = [...counts.entries()]
    .map(([reason, count]) => `${SKIP_REASON_LABELS[reason]} ${count}`)
    .join(', ');
  return ` • 제외 ${completed.skipped.length}건 — ${reasonText}`;
};

const sideLabel = (side: 'BUY' | 'SELL'): string =>
  side === 'BUY' ? '매수' : '매도';

const formatMoney = (amount: number): string => {
  if (Math.abs(amount) < 10_000) {
    return `${Math.round(amount).toLocaleString('ko-KR')}원`;
  }
  return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
};

const firstLineOf = (message: string): string => message.split(/\r?\n/, 1)[0];

@Injectable()
export class PaperRecommendAutopilotTask implements AutopilotTask {
  readonly id = 'paper-recommend';

  constructor(
    private readonly generateRecommendation: GeneratePaperRecommendationUsecase,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    const result = await this.generateRecommendation.execute({
      decidedAt: new Date(`${context.firedAtKst}T19:30:00+09:00`),
      triggerType: TriggerType.AUTOPILOT_PAPER_RECOMMEND_CRON,
    });
    return formatResult(result);
  }
}
