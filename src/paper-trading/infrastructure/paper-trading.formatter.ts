import { Prisma } from '@prisma/client';

import { EvaluateAccountResult } from '../application/evaluate-paper-account.usecase';
import { PaperTradingStatusResult } from '../application/get-paper-trading-status.usecase';

const escapeSlackMrkdwn = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const addThousandsSeparators = (value: string): string => {
  const [integer, fraction] = value.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const digits = sign ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
};

const formatDecimal = (value: string): string =>
  addThousandsSeparators(new Prisma.Decimal(value).toString());

const formatMoney = (value: string | null): string =>
  value === null ? '-' : `${formatDecimal(value)}원`;

const formatRate = (value: string | null): string => {
  if (value === null) {
    return '-';
  }
  const rate = new Prisma.Decimal(value);
  const sign = rate.comparedTo(0) > 0 ? '+' : '';
  return `${sign}${rate.toDecimalPlaces(2).toString()}%`;
};

// 자연어 조회("수익률 어때") 응답용 — 읽기 전용 현황이다.
// 장마감 평가(formatPaperTradingReport)와 달리 시세를 새로 조회하지도, 스냅샷을 적재하지도
// 않는다. 수익률은 마지막으로 적재된 평가 스냅샷 기준임을 날짜로 함께 드러낸다.
export const formatPaperTradingStatus = (
  status: PaperTradingStatusResult,
): string => {
  // findRecentSnapshots 는 tradeDate desc 로 조회한다 — [0] 이 최신 평가다.
  const latest = status.snapshots.at(0);
  const lines = [
    `*가상 계좌 현황 — ${escapeSlackMrkdwn(status.account.name)}*`,
    '',
  ];
  if (latest) {
    lines.push(
      `최근 평가 (${latest.tradeDate}) · 총 평가액 *${formatMoney(latest.totalValue)}* · 수익률 *${formatRate(latest.returnRate)}*`,
    );
  } else {
    lines.push(
      '_아직 평가 스냅샷이 없어요 — 장마감 평가가 한 번도 적재되지 않았습니다._',
    );
  }
  lines.push(
    `시드 ${formatMoney(status.account.seedAmount)} · 현금 ${formatMoney(status.account.cashBalance)}`,
    '',
  );

  if (status.positions.length === 0) {
    lines.push('_보유 종목 없음_');
  } else {
    lines.push('*보유 종목*');
    for (const position of status.positions) {
      lines.push(
        `• *${escapeSlackMrkdwn(position.tickerName)}* (\`${position.tickerCode}\`) · ${formatDecimal(position.quantity)}주 · 평단 ${formatMoney(position.avgPrice)}`,
      );
    }
  }

  // 최신 1건은 위에 이미 있으므로 추이는 2건 이상일 때만 덧붙인다.
  if (status.snapshots.length > 1) {
    lines.push(
      '',
      '*최근 추이*',
      status.snapshots
        .map(
          (snapshot) =>
            `${snapshot.tradeDate} ${formatRate(snapshot.returnRate)}`,
        )
        .join(' · '),
    );
  }
  return lines.join('\n');
};

// 계좌 여러 개 — 전략별 계좌(LONG_TERM / SWING)가 각각 독립 시드를 갖기 때문에 합산 수익률을
// 만들지 않는다. 시드가 다른 계좌의 수익률을 단순 평균하면 실제와 다른 숫자가 되고, 가중
// 합산은 전략별 성적을 가리는 값이다. 계좌별로 나란히 보여주고 판단은 읽는 사람이 한다.
export const formatPaperPortfolioStatus = (
  statuses: PaperTradingStatusResult[],
): string => {
  if (statuses.length === 0) {
    return '가상 매매 계좌가 아직 없어요 — 계좌가 열리면 여기서 수익률을 보여드릴게요.';
  }
  return statuses.map(formatPaperTradingStatus).join('\n\n---\n\n');
};

export const formatPaperTradingReport = (
  result: EvaluateAccountResult,
): string => {
  const lines = [
    `*가상 매매 장마감 평가 — ${result.tradeDate ?? '거래일 미확정'}*`,
  ];
  if (result.skipped) {
    lines.push(`⚠️ 스냅샷 미적재 — ${result.skipReason ?? '사유 미상'}`);
  }
  lines.push('');

  if (result.positionCount === 0) {
    lines.push('_보유 없음_');
  } else if (result.positions.length > 0) {
    for (const position of result.positions) {
      const staleLabel = position.isStale
        ? ` _⚠️ stale: ${position.priceDate}_`
        : '';
      lines.push(
        `• *${escapeSlackMrkdwn(position.tickerName)}* (\`${position.tickerCode}\`)${staleLabel}`,
        `  ${formatDecimal(position.quantity)}주 · 평단 ${formatMoney(position.avgPrice)} · 현재가 ${formatMoney(position.price)} · 평가액 ${formatMoney(position.marketValue)} · 손익률 ${formatRate(position.returnRate)}`,
      );
    }
  }

  if (result.unpricedPositions.length > 0) {
    lines.push('', '*평가 시세 미확보*');
    for (const position of result.unpricedPositions) {
      lines.push(
        `• *${escapeSlackMrkdwn(position.tickerName)}* (\`${position.tickerCode}\`) · ${formatDecimal(position.quantity)}주 · 평단 ${formatMoney(position.avgPrice)}`,
      );
    }
  }

  lines.push(
    '',
    `총 평가액 *${formatMoney(result.totalValue)}* · 현금 ${formatMoney(result.cashBalance)} · 총 수익률 *${formatRate(result.returnRate)}*`,
  );
  if (result.benchmarkClose !== null) {
    lines.push(`벤치마크 종가 ${formatDecimal(result.benchmarkClose)}`);
  }
  return lines.join('\n');
};
