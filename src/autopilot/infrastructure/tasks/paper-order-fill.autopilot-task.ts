import { Injectable } from '@nestjs/common';

import {
  FillPendingOrdersResult,
  FillPendingOrdersUsecase,
  PaperOrderFillDetail,
} from '../../../paper-trading/application/fill-pending-orders.usecase';
import { TradeSide } from '../../../paper-trading/domain/paper-account.type';
import { escapeSlackMrkdwn } from '../../../slack/format/mrkdwn.util';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const ACCOUNT_LABELS: Record<string, string> = {
  LONG_TERM: '장기',
  SWING: '스윙',
};

const formatResult = (result: FillPendingOrdersResult): AutopilotTaskResult => {
  if (result.window === 'BEFORE_OPEN') {
    return {
      skip: true,
      summaryText: '모의투자 체결 시간 창 이전 — 주문 미처리',
    };
  }
  const filled = result.details.filter((detail) => detail.outcome === 'FILLED');
  const unfilled = result.details.filter(
    (detail) => detail.outcome !== 'FILLED',
  );
  // 헤더가 매수·매도 순으로 요약하므로 목록도 같은 순서로 묶어 읽는 눈이 되돌아가지 않게 한다.
  const buyFirst = [
    ...filled.filter((detail) => detail.side === 'BUY'),
    ...filled.filter((detail) => detail.side === 'SELL'),
  ];
  const lines = [
    `*모의투자 체결* — ${formatHeadline(result, filled)}`,
    ...buyFirst.map(formatFilledLine),
    ...unfilled.map(formatUnfilledLine),
  ];
  if (result.bulkExpired > 0) {
    lines.push(
      ` • 장 마감까지 체결가를 못 받아 만료 ${result.bulkExpired}건 — 주문은 사라지고 다음 추천을 기다립니다`,
    );
  }
  // 이미 처리된 주문(겹친 실행·수동 fill)은 어느 집계에도 안 잡혀 상세에서 조용히 빠진다.
  // 체결이 섞인 회차에서도 빠지므로 줄 수가 아니라 시도 건수와 상세 수의 차로 판별한다.
  const unaccounted = result.attempted - result.details.length;
  if (unaccounted > 0) {
    lines.push(
      ` • 대기 주문 ${unaccounted}건은 이미 다른 회차에서 처리돼 이번 회차엔 바뀐 것이 없습니다`,
    );
  }
  return { skip: false, summaryText: lines.join('\n') };
};

// 헤더는 "얼마어치 사고팔았나" 를 먼저 알린다. 체결이 없으면 그 이유를 대신 적는다.
const formatHeadline = (
  result: FillPendingOrdersResult,
  filled: PaperOrderFillDetail[],
): string => {
  if (filled.length === 0) {
    if (result.attempted === 0) {
      return '대기 중인 주문이 없어 체결 0건';
    }
    return `체결 0건, 대기 주문 ${result.attempted}건은 아래 사유로 처리 못 함`;
  }
  const buy = filled.filter((detail) => detail.side === 'BUY');
  const sell = filled.filter((detail) => detail.side === 'SELL');
  return [buy, sell]
    .filter((group) => group.length > 0)
    .map(
      (group) =>
        `${sideLabel(group[0].side)} ${group.length}건 ${formatMoney(totalAmount(group))}`,
    )
    .join(' · ');
};

const formatFilledLine = (detail: PaperOrderFillDetail): string =>
  ` • ${describeOrder(detail)} ${formatQuantity(detail.quantity)}주 ` +
  `@${formatWon(detail.price ?? '0')} = ${formatMoney(amountOf(detail))}`;

const formatUnfilledLine = (detail: PaperOrderFillDetail): string =>
  ` • 미체결 ${describeOrder(detail)} ${formatQuantity(detail.quantity)}주 — ` +
  unfilledReason(detail);

const unfilledReason = (detail: PaperOrderFillDetail): string => {
  if (detail.outcome === 'EXPIRED') {
    return `${detail.reason ?? '사유 미상'}(주문 취소됨)`;
  }
  if (detail.outcome === 'LOOKUP_FAILURE') {
    return '시세를 못 받음(다음 회차 재시도)';
  }
  return '당일 거래 기록이 아직 없음(다음 회차 재시도)';
};

const describeOrder = (detail: PaperOrderFillDetail): string =>
  `[${accountLabel(detail.accountName)}] ${sideLabel(detail.side)} ` +
  `*${escapeSlackMrkdwn(detail.tickerName)}*(${detail.tickerCode})`;

const accountLabel = (accountName: string): string =>
  ACCOUNT_LABELS[accountName] ?? escapeSlackMrkdwn(accountName);

const sideLabel = (side: TradeSide): string =>
  side === 'BUY' ? '매수' : '매도';

const amountOf = (detail: PaperOrderFillDetail): number =>
  Number(detail.quantity) * Number(detail.price ?? 0);

const totalAmount = (details: PaperOrderFillDetail[]): number =>
  details.reduce((sum, detail) => sum + amountOf(detail), 0);

const formatQuantity = (quantity: string): string =>
  Number(quantity).toLocaleString('ko-KR');

const formatWon = (price: string): string =>
  `${Math.round(Number(price)).toLocaleString('ko-KR')}원`;

const formatMoney = (amount: number): string => {
  if (Math.abs(amount) < 10_000) {
    return `${Math.round(amount).toLocaleString('ko-KR')}원`;
  }
  return `${Math.round(amount / 10_000).toLocaleString('ko-KR')}만`;
};

@Injectable()
export class PaperOrderFillAutopilotTask implements AutopilotTask {
  readonly id = 'paper-order-fill';

  constructor(private readonly fillPendingOrders: FillPendingOrdersUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const result = await this.fillPendingOrders.execute();
    return formatResult(result);
  }
}
