import { Prisma } from '@prisma/client';

import { EvaluateAccountResult } from '../application/evaluate-paper-account.usecase';

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
