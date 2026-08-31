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

// 손익은 부호가 곧 뜻이라 양수에도 + 를 붙인다. 평단이 소수라 손익도 소수로 떨어지는데,
// 원 단위 밑자리는 읽는 데 방해만 되어 반올림한다.
const formatSignedMoney = (value: string | null): string => {
  if (value === null) {
    return '-';
  }
  const amount = new Prisma.Decimal(value).toDecimalPlaces(0);
  const sign = amount.comparedTo(0) > 0 ? '+' : '';
  return `${sign}${addThousandsSeparators(amount.toString())}원`;
};

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
    // 증권사 계좌와 같은 D+0 / D+2 표기를 쓴다. "예수금 · 미결제 대금" 으로 적으면
    // 매수 대금이 아직 안 빠진 날 예수금이 현금보다 커 보여(2,106,271원인데 5,417,053원)
    // 어느 쪽이 실제 잔고인지 읽히지 않는다. 장부의 cashBalance 는 체결 즉시 반영이라
    // 결제가 다 끝난 뒤의 잔고, 곧 D+2 다.
    `예수금 D+0 ${formatMoney(result.settledCash)} · D+2 ${formatMoney(result.cashBalance)}`,
  );
  // 배당은 권리락일에 잔고로 잡히지만 지급일까지는 쓸 수 없다. 두 줄 위의 예수금은 매매
  // 결제(D+0/D+2)만 가르므로 그 돈이 어디에도 드러나지 않아, 잔고를 그대로 매수 여력으로
  // 읽게 된다. 미수분이 있는 날만 적는다 — 없는 날 0 원 줄은 읽을 것이 없다.
  if (new Prisma.Decimal(result.pendingDividendCash).comparedTo(0) > 0) {
    const payDateNote =
      result.nextDividendPayDate === null
        ? ''
        : ` (${result.nextDividendPayDate} 지급)`;
    lines.push(
      `미수 배당 ${formatMoney(result.pendingDividendCash)}${payDateNote} · 매수 가능 ${formatMoney(result.purchasableCash)}`,
    );
  }
  const dividendCount = result.dividendCount ?? 0;
  // 전일 대비를 적을 때 배당을 함께 밝힌다. 소급 반영한 배당은 과거 스냅샷을 고치지
  // 않으므로(그날 실제로 무엇을 봤는지가 기록이다) 입금 당일만 하루 만에 급등한 것처럼
  // 보인다. 괄호가 없으면 그 폭을 시장에서 번 것으로 읽는다.
  if (result.previousReturnRate != null && result.returnRate !== null) {
    const dividendNote =
      dividendCount > 0
        ? ` (배당 반영 ${formatSignedMoney(result.dividendNetTotal)})`
        : '';
    lines.push(
      `전일 ${formatRate(result.previousReturnRate)} → 오늘 ${formatRate(result.returnRate)}${dividendNote}`,
    );
  }
  // 배당이 있으면 매매분과 갈라 적는다. realizedPnl 은 역산이라 배당을 흡수하는데,
  // 그 값 하나만 "확정 손익" 으로 내면 종목을 골라 번 돈과 배당이 뭉쳐 추천 채점이
  // 불가능해진다. 배당이 없는 계좌는 가를 것이 없으므로 기존 한 줄 그대로 둔다.
  if (result.realizedPnl !== null && result.unrealizedPnl !== null) {
    const realizedText =
      dividendCount > 0 && result.tradingRealizedPnl != null
        ? `매매 확정손익 ${formatSignedMoney(result.tradingRealizedPnl)} · 배당 ${dividendCount}건 ${formatSignedMoney(result.dividendNetTotal)}`
        : `확정 손익 ${formatSignedMoney(result.realizedPnl)}`;
    lines.push(
      `${realizedText} · 보유 평가손익 ${formatSignedMoney(result.unrealizedPnl)}`,
    );
  }
  if (result.benchmarkClose !== null) {
    lines.push(`벤치마크 종가 ${formatDecimal(result.benchmarkClose)}`);
  }
  return lines.join('\n');
};
