import { Prisma } from '@prisma/client';

import type {
  EveningLine,
  EveningTodoSummary,
} from '../../schedule/application/build-evening-todo-summary.usecase';
import { EVENING_LIST_MAX } from '../../schedule/domain/daily-todo.constant';
import {
  escapeSlackMrkdwn,
  isSafeHttpUrl,
  sanitizeForSlackLink,
} from '../../slack/format/mrkdwn.util';
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
  problem: string | null;
  tryNext: string | null;
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
  todoSummary?: EveningTodoSummary;
}

const KEEP_MAX_LENGTH = 60;

// 계좌 이름(paper_account.name) → 화면 이름. 모르는 이름은 그대로 보인다.
export const PAPER_ACCOUNT_LABEL: Record<string, string> = {
  LONG_TERM: '장기투자',
  SWING: '단기매매',
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

const formatEveningLine = (line: EveningLine): string => {
  const title =
    line.url && isSafeHttpUrl(line.url)
      ? `<${sanitizeForSlackLink(line.url)}|${sanitizeForSlackLink(line.title)}>`
      : escapeSlackMrkdwn(line.title);
  return `• ${title}${line.detail ? ` (${escapeSlackMrkdwn(line.detail)})` : ''}`;
};

const formatEveningLines = (lines: EveningLine[]): string[] => [
  ...lines.slice(0, EVENING_LIST_MAX).map(formatEveningLine),
  ...(lines.length > EVENING_LIST_MAX
    ? [`• 외 ${lines.length - EVENING_LIST_MAX}개`]
    : []),
];

// 아침 목록 안 → 밖 순서로 세우고, 밖은 소제목 한 줄 아래에 모은다. 줄마다 꼬리를 달았더니
// 목록 밖만 있던 날 모든 줄에 같은 말이 반복됐다(2026-11-05 피드백).
const formatDoneLines = (lines: EveningLine[]): string[] => {
  const ordered = [
    ...lines.filter((line) => !line.outsideMorningList),
    ...lines.filter((line) => line.outsideMorningList),
  ];
  const rendered = formatEveningLines(ordered);
  const firstOutside = ordered
    .slice(0, EVENING_LIST_MAX)
    .findIndex((line) => line.outsideMorningList);
  if (firstOutside >= 0) {
    rendered.splice(firstOutside, 0, '_아침 목록 밖_');
  }
  return rendered;
};

// 투자 줄은 항목마다 한 줄 — 한 줄에 `·` 로 이어 붙였더니 수익률과 체결 건수가 섞여 읽혔다
// (2026-10-28 피드백). 항목 이름을 앞에 두어 숫자만 훑어도 무엇인지 보이게 한다.
const formatInvestLines = (
  invest: NonNullable<EveningDigestInput['invest']>,
): string[] => {
  const lines: string[] = invest.returns.map(
    (entry) =>
      `• ${PAPER_ACCOUNT_LABEL[entry.accountName] ?? escapeSlackMrkdwn(entry.accountName)} 수익률 ${formatRate(entry.returnRate)}`,
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
  const summary = input.todoSummary;
  const doneLines =
    summary && !summary.loadFailed
      ? [
          // 조회 실패 안내는 맨 위에 둔다 — 끝에 두면 「아침 목록 밖」 소제목 아래 끝낸 일처럼 읽힌다.
          ...(input.mergedPrCount === null
            ? ['• 머지한 PR을 확인하지 못했어요']
            : []),
          ...formatDoneLines(summary.done),
          ...(summary.extraMergedPrCount > 0
            ? [`• 그 밖에 머지한 PR ${summary.extraMergedPrCount}건`]
            : []),
        ]
      : [
          input.mergedPrCount === null
            ? '• 머지한 PR을 확인하지 못했어요'
            : `• PR ${input.mergedPrCount}건 머지`,
        ];
  if (doneLines.length > 0 || input.retroFailure) {
    sections.push(
      [
        '*한 일*',
        ...doneLines,
        ...(input.retroFailure
          ? [
              `_회고를 만들지 못했어요 (${escapeSlackMrkdwn(input.retroFailure)}). 내일 다시 시도해요._`,
            ]
          : []),
      ].join('\n'),
    );
  }
  if (summary && !summary.loadFailed) {
    if (summary.notDone.length > 0) {
      sections.push(
        ['*못 한 일*', ...formatEveningLines(summary.notDone)].join('\n'),
      );
    }
    const numbers: string[] = [];
    if (summary.ratio && summary.ratio.total > 0) {
      numbers.push(
        `• 아침 할 일 ${summary.ratio.total}개 중 ${summary.ratio.done}개 끝냄 (${Math.round((summary.ratio.done / summary.ratio.total) * 100)}%)`,
      );
    }
    if (summary.waiting && summary.waiting.count > 0) {
      numbers.push(
        `• 남을 기다린 일 ${summary.waiting.count}개${summary.waiting.atLeast ? ' 이상' : ''}${summary.waiting.longest ? `, 가장 긴 것은 ${escapeSlackMrkdwn(summary.waiting.longest)}` : ''}`,
      );
    }
    if (
      summary.backlog &&
      summary.backlog.myTurn +
        summary.backlog.waiting +
        summary.backlog.unknown >
        0
    ) {
      const { myTurn, waiting, unknown } = summary.backlog;
      numbers.push(
        `• 밀린 일 ${myTurn + waiting + unknown}개: 내 차례 ${myTurn}개, 남 기다림 ${waiting}개, 확인 못 함 ${unknown}개`,
      );
    }
    if (numbers.length > 0) {
      sections.push(['*숫자로 보면*', ...numbers].join('\n'));
    }
  }

  for (const [heading, text] of [
    ['아쉬운 점', input.problem],
    ['잘한 점', input.keep],
    ['내일 추천', input.tryNext],
  ]) {
    if (text) {
      sections.push(
        `*${heading}*\n• ${escapeSlackMrkdwn(firstSentence(text))}`,
      );
    }
  }

  const rest = [
    ...(input.invest ? formatInvestLines(input.invest) : []),
    ...(input.carriedApprovalCount > 0
      ? [`• 승인 대기 ${input.carriedApprovalCount}장`]
      : []),
    ...input.incidents.map(
      (incident) =>
        `• ${escapeSlackMrkdwn(incident.label)}${incident.dayCount === null ? '' : ` (${incident.dayCount}일째)`}`,
    ),
  ];
  if (rest.length) {
    sections.push(['*그 밖에*', ...rest].join('\n'));
  }
  return sections.join('\n\n');
};
