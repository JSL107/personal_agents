import { Prisma } from '@prisma/client';

import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { MorningIncident } from './morning-digest.formatter';
import { formatTradeDay } from './paper-number.formatter';

// 저녁 마감 한 통 — "한 일 나열" 대신 결과와 내일로 넘어가는 것만.
// 방향: docs/superpowers/plans/2026-10-08-daily-message-direction.md §3-2.
// 회고 전문·발행 후보·판정 버튼·승인 카드는 이 메시지의 스레드에 온다.

export interface EveningPaperCount {
  buyCount: number;
  sellCount: number;
}

export interface EveningNextOrders extends EveningPaperCount {
  // 다음 체결일(YYYY-MM-DD). "내일" 로 적지 않는다 — 금요일 추천의 체결일은 월요일이다.
  tradeDate: string;
}

// 마감 한 줄의 재료 중 회고가 채우는 것.
export interface EveningRetroContext {
  // 회고의 Keep 칸 — "오늘 무엇이 잘 됐나" 한 문장. 회고가 없으면 null.
  keep: string | null;
  // 회고 생성에 실패했을 때의 사유. 결과 줄은 그대로 내고 이 사실만 덧붙인다.
  retroFailure: string | null;
}

// 마감 한 줄의 재료 중 회고와 무관한 것(투자·넘어가는 것).
export interface EveningCarryContext {
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

export interface EveningDigestInput
  extends EveningRetroContext, EveningCarryContext {
  firedAtKst: string;
  // null = 머지 PR 조회가 실패했다 — "0건" 과 구분한다.
  mergedPrCount: number | null;
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

// 투자 줄은 항목마다 한 줄 — 한 줄에 `·` 로 이어 붙였더니 수익률과 체결 건수가 섞여 읽혔다
// (2026-10-28 피드백). 항목 이름을 앞에 두어 숫자만 훑어도 무엇인지 보이게 한다.
const formatInvestLines = (
  invest: NonNullable<EveningDigestInput['invest']>,
): string[] => {
  const lines: string[] = invest.returns.map(
    (entry) =>
      `• ${ACCOUNT_LABEL[entry.accountName] ?? escapeSlackMrkdwn(entry.accountName)} 수익률  ${formatRate(entry.returnRate)}`,
  );
  const { buyCount, sellCount } = invest.filled;
  if (buyCount + sellCount > 0) {
    lines.push(`• 오늘 체결  매수 ${buyCount} · 매도 ${sellCount}`);
  }
  if (invest.next === undefined) {
    lines.push('• 다음 체결  추천 집계 전');
  } else if (invest.next) {
    lines.push(
      `• ${formatTradeDay(invest.next.tradeDate)} 시가  매수 ${invest.next.buyCount} · 매도 ${invest.next.sellCount} 예정`,
    );
  }
  return lines;
};

// 묶음마다 굵은 이름 한 줄 + 내용, 묶음 사이는 빈 줄. 오늘 한 일의 핵심 문장은 인용으로 떼어
// 건수 옆에 붙지 않게 한다.
export const formatEveningDigest = (input: EveningDigestInput): string => {
  const sections = [`🌙 *${formatTradeDay(input.firedAtKst)} 마감*`];

  const today = [
    input.mergedPrCount === null
      ? '*오늘 한 일*  ⚠️ 머지 PR 조회 실패 — 건수 미상'
      : `*오늘 한 일*  PR ${input.mergedPrCount}건 머지`,
  ];
  if (input.keep) {
    today.push(`> ${escapeSlackMrkdwn(firstSentence(input.keep))}`);
  }
  if (input.retroFailure) {
    today.push(
      `_⚠️ 회고 자동 생성 실패(${escapeSlackMrkdwn(input.retroFailure)}) — 내일 다시 시도합니다_`,
    );
  }
  sections.push(today.join('\n'));

  const investLines = input.invest ? formatInvestLines(input.invest) : [];
  if (investLines.length > 0) {
    sections.push(['*투자*', ...investLines].join('\n'));
  }

  const carried = [
    input.carriedApprovalCount > 0
      ? `• 승인 대기 ${input.carriedApprovalCount}장`
      : null,
    ...input.incidents.map(
      (incident) =>
        `• 🔴 ${escapeSlackMrkdwn(incident.label)}${incident.dayCount === null ? '' : ` ${incident.dayCount}일째`}`,
    ),
  ].filter((part): part is string => part !== null);
  if (carried.length > 0) {
    sections.push(['*넘어감*', ...carried].join('\n'));
  }

  return sections.join('\n\n');
};
