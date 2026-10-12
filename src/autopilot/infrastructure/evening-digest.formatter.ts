import { Prisma } from '@prisma/client';

import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { MorningIncident } from './morning-digest.formatter';
import { formatTradeDay } from './paper-number.formatter';

// 저녁 마감 한 통 — "한 일 나열" 대신 결과 한 줄과 내일로 넘어가는 것만.
// 방향: docs/superpowers/plans/2026-10-08-daily-message-direction.md §3-2.
// 회고 전문·발행 후보·판정 버튼은 스레드에, 승인 카드는 이 메시지 바로 아래에 따로 온다.

export interface EveningPaperCount {
  buyCount: number;
  sellCount: number;
}

export interface EveningNextOrders extends EveningPaperCount {
  // 다음 체결일(YYYY-MM-DD). "내일" 로 적지 않는다 — 금요일 추천의 체결일은 월요일이다.
  tradeDate: string;
}

export interface EveningDigestInput {
  firedAtKst: string;
  // null = 머지 PR 조회가 실패했다 — "0건" 과 구분한다.
  mergedPrCount: number | null;
  // 회고의 Keep 칸 — "오늘 무엇이 잘 됐나" 한 문장. 회고가 없으면 null.
  keep: string | null;
  // 회고 생성에 실패했을 때의 사유. 결과 줄은 그대로 내고 이 사실만 덧붙인다.
  retroFailure: string | null;
  invest: {
    returns: { accountName: string; returnRate: string }[];
    filled: EveningPaperCount;
    // undefined = 오늘 추천(19:30)이 아직 원장에 없다 — "예정 없음" 과 구분한다.
    // null = 추천은 돌았고 다음 체결일에 잡힌 주문이 없다.
    next: EveningNextOrders | null | undefined;
  } | null;
  carriedApprovalCount: number;
  incidents: MorningIncident[];
}

const KEEP_MAX_LENGTH = 60;

// 계좌 이름(paper_account.name) → 화면 이름. 모르는 이름은 그대로 보인다.
const ACCOUNT_LABEL: Record<string, string> = {
  LONG_TERM: '장기',
  SWING: '스윙',
  DEFAULT: '기본',
};

const formatRate = (value: string): string => {
  const rate = new Prisma.Decimal(value);
  const sign = rate.comparedTo(0) > 0 ? '+' : '';
  return `${sign}${rate.toDecimalPlaces(2).toString()}%`;
};

const firstSentence = (text: string): string => {
  const sentence = text.split(/(?<=[.!?。])\s|\n/)[0]?.trim() ?? '';
  return sentence.length <= KEEP_MAX_LENGTH
    ? sentence
    : `${sentence.slice(0, KEEP_MAX_LENGTH)}…`;
};

const formatInvest = (
  invest: NonNullable<EveningDigestInput['invest']>,
): string | null => {
  const parts: string[] = invest.returns.map(
    (entry) =>
      `${ACCOUNT_LABEL[entry.accountName] ?? escapeSlackMrkdwn(entry.accountName)} ${formatRate(entry.returnRate)}`,
  );
  const { buyCount, sellCount } = invest.filled;
  if (buyCount + sellCount > 0) {
    parts.push(`오늘 체결 매수 ${buyCount} · 매도 ${sellCount}`);
  }
  if (invest.next === undefined) {
    parts.push('내일 추천 집계 전');
  } else if (invest.next) {
    parts.push(
      `${formatTradeDay(invest.next.tradeDate)} 시가 매수 ${invest.next.buyCount} · 매도 ${invest.next.sellCount} 예정`,
    );
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

export const formatEveningDigest = (input: EveningDigestInput): string => {
  const lines = [`🌙 *${formatTradeDay(input.firedAtKst)} 마감*`];

  const todayParts = [
    input.mergedPrCount === null
      ? '⚠️ 머지 PR 조회 실패 — 건수 미상'
      : `PR ${input.mergedPrCount}건 머지`,
  ];
  if (input.keep) {
    todayParts.push(`핵심: ${escapeSlackMrkdwn(firstSentence(input.keep))}`);
  }
  lines.push(`• 오늘  ${todayParts.join(' · ')}`);
  if (input.retroFailure) {
    lines.push(
      `  _⚠️ 회고 자동 생성 실패(${escapeSlackMrkdwn(input.retroFailure)}) — 내일 다시 시도합니다_`,
    );
  }

  const investText = input.invest ? formatInvest(input.invest) : null;
  if (investText) {
    lines.push(`• 투자  ${investText}`);
  }

  const carried = [
    input.carriedApprovalCount > 0
      ? `승인 대기 ${input.carriedApprovalCount}장`
      : null,
    ...input.incidents.map(
      (incident) =>
        `🔴 ${escapeSlackMrkdwn(incident.label)}${incident.dayCount === null ? '' : ` ${incident.dayCount}일째`}`,
    ),
  ].filter((part): part is string => part !== null);
  if (carried.length > 0) {
    lines.push(`• 넘어감  ${carried.join(' · ')}`);
  }

  return lines.join('\n');
};
