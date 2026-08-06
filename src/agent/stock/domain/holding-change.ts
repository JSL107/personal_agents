import { createHash } from 'node:crypto';

import { DecimalValue } from '../../../market-data/domain/market-data.type';

export type HoldingChangeKind =
  | 'BOUGHT'
  | 'SOLD_ALL'
  | 'INCREASED'
  | 'DECREASED'
  | 'AVG_PRICE_CHANGED';

// 비교 대상 잔고 한 줄. 직전 스냅샷(DB)과 새로 읽은 잔고(브로커)를 같은 모양으로 맞춰
// 판정이 어느 쪽에서 왔는지 몰라도 되게 한다.
export interface HoldingPosition {
  tickerId: number;
  tickerName: string;
  symbol: string;
  quantity: DecimalValue;
  avgPrice: DecimalValue;
  currency: string;
}

export interface HoldingChange {
  tickerId: number;
  tickerName: string;
  symbol: string;
  kind: HoldingChangeKind;
  // 신규 매수는 직전 값이 없다.
  previousQuantity: string | null;
  quantity: string;
  previousAvgPrice: string | null;
  avgPrice: string;
  currency: string;
}

// 스냅샷은 Decimal(18,4) 로 저장된다. 브로커 원본 정밀도와 직접 비교하면 5자리 밖 자릿수
// 때문에 아무 매매가 없어도 매일 "평단 변동"이 잡히므로, 저장 정밀도로 맞춰 비교한다.
const STORED_DECIMALS = 4;
const STORED_SCALE = 10n ** BigInt(STORED_DECIMALS);

// 저장 정밀도로 반올림한 값을 1e-4 단위 정수로 돌려준다.
//
// toNumber() 를 쓰지 않는다: Decimal(18,4) 가 허용하는 최대값에 10^4 를 곱하면 약 1e18 로
// Number.MAX_SAFE_INTEGER(9.0e15) 를 넘어, 서로 다른 저장 가능 값이 같은 double 로 뭉개져
// 실제 수량·평단 변화가 조용히 누락될 수 있다. 금액을 다루는 비교라 그 경계를 남기지 않고
// 문자열을 그대로 BigInt 로 옮긴다(자릿수 제한 없음, 부동소수 동등 비교 문제도 함께 사라진다).
//
// DB 가 반올림 저장하므로 판정도 half-up 반올림이어야 스냅샷과 어긋나지 않는다.
const toStoredUnits = (value: DecimalValue): bigint => {
  const text = value.toString().trim();
  const negative = text.startsWith('-');
  const unsigned = negative || text.startsWith('+') ? text.slice(1) : text;
  const [integer, fraction] = unsigned.split('.');
  // 반올림 판단에 쓸 다섯째 자리까지 확보한다.
  const padded = (fraction ?? '').padEnd(STORED_DECIMALS + 1, '0');
  const truncated = BigInt(
    `${integer || '0'}${padded.slice(0, STORED_DECIMALS)}`,
  );
  const rounded = padded[STORED_DECIMALS] >= '5' ? truncated + 1n : truncated;
  return negative ? -rounded : rounded;
};

const fromStoredUnits = (units: bigint): string => {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const fraction = (absolute % STORED_SCALE)
    .toString()
    .padStart(STORED_DECIMALS, '0')
    .replace(/0+$/, '');
  const integer = (absolute / STORED_SCALE).toString();
  const sign = negative ? '-' : '';
  return fraction ? `${sign}${integer}.${fraction}` : `${sign}${integer}`;
};

// 기록에 담는 값도 저장 정밀도로 맞춘다. 브로커 원본을 그대로 담으면 같은 사건인데도 조회
// 시점마다 문자열이 달라져(26.824493 vs 26.8245) 지문이 갈리고 중복 차단이 무력해진다.
const toStoredString = (value: DecimalValue): string =>
  fromStoredUnits(toStoredUnits(value));

const compare = (
  before: HoldingPosition,
  after: HoldingPosition,
): HoldingChange | null => {
  const beforeQuantity = toStoredUnits(before.quantity);
  const afterQuantity = toStoredUnits(after.quantity);

  const base = {
    tickerId: after.tickerId,
    tickerName: after.tickerName,
    symbol: after.symbol,
    previousQuantity: toStoredString(before.quantity),
    quantity: toStoredString(after.quantity),
    previousAvgPrice: toStoredString(before.avgPrice),
    avgPrice: toStoredString(after.avgPrice),
    currency: after.currency,
  };

  if (afterQuantity === 0n) {
    // 브로커가 0 수량 종목을 그대로 실어 보내는 경우. 응답에서 빠지는 경로와 같은 사건이다.
    return beforeQuantity === 0n ? null : { ...base, kind: 'SOLD_ALL' };
  }
  if (afterQuantity > beforeQuantity) {
    return { ...base, kind: 'INCREASED' };
  }
  if (afterQuantity < beforeQuantity) {
    return { ...base, kind: 'DECREASED' };
  }
  // 수량이 같은데 평단이 움직였다 — 같은 날 사고팔아 수량이 되돌아왔거나 브로커가 재계산했다.
  // 수량 변화에 딸린 평단 변화는 INCREASED/DECREASED 안에 이미 담겨 있으므로 여기서 다루지 않는다.
  if (toStoredUnits(after.avgPrice) !== toStoredUnits(before.avgPrice)) {
    return { ...base, kind: 'AVG_PRICE_CHANGED' };
  }
  return null;
};

// 직전 스냅샷과 새 잔고를 비교해 그 사이에 일어난 매매를 사건으로 뽑는다.
//
// 비교 기준은 "직전 날짜"가 아니라 "직전 동기화"다. 잔고는 하루 두 번(국내·미국 감시) 갱신되고
// 두 감시는 같은 UTC 날짜를 공유하므로, 오후 감시는 오전 감시가 써둔 같은 날짜 행과 비교한다.
// 결과적으로 각 감시가 "직전 감시 이후의 변화"만 집어 중복도 누락도 없다.
//
// 따라서 시장으로 걸러서는 안 된다. 국내 감시와 미국 감시 사이에 일어난 국내 매매는 미국 감시의
// 비교 구간에만 나타나므로, 미국 감시에서 국내 종목을 버리면 그 매매는 어디에도 남지 않는다.
export const detectHoldingChanges = (
  previous: HoldingPosition[],
  current: HoldingPosition[],
): HoldingChange[] => {
  const remaining = new Map(
    previous.map((position) => [position.tickerId, position]),
  );
  const changes: HoldingChange[] = [];

  for (const position of current) {
    const before = remaining.get(position.tickerId);
    remaining.delete(position.tickerId);
    if (!before) {
      if (toStoredUnits(position.quantity) === 0n) {
        continue;
      }
      changes.push({
        tickerId: position.tickerId,
        tickerName: position.tickerName,
        symbol: position.symbol,
        kind: 'BOUGHT',
        previousQuantity: null,
        quantity: toStoredString(position.quantity),
        previousAvgPrice: null,
        avgPrice: toStoredString(position.avgPrice),
        currency: position.currency,
      });
      continue;
    }
    const change = compare(before, position);
    if (change) {
      changes.push(change);
    }
  }

  // 응답에서 사라진 종목 = 전량 매도. 브로커가 평단을 더는 알려주지 않으므로 직전 값을 그대로 쓴다.
  //
  // 전량 매도된 종목은 직전 스냅샷 조회에서 수량 0 으로 걸러지므로, 팔고 다시 사면
  // 직전 값이 없는 것으로 보여 BOUGHT("신규 매수")로 잡힌다. 계좌에 없던 종목이 생긴 것은
  // 맞으므로 표현으로도 틀리지 않고, 되돌아온 사실은 이 표의 과거 SOLD_ALL 행에 남아 있다.
  for (const before of remaining.values()) {
    changes.push({
      tickerId: before.tickerId,
      tickerName: before.tickerName,
      symbol: before.symbol,
      kind: 'SOLD_ALL',
      previousQuantity: toStoredString(before.quantity),
      quantity: '0',
      previousAvgPrice: toStoredString(before.avgPrice),
      avgPrice: toStoredString(before.avgPrice),
      currency: before.currency,
    });
  }

  return changes;
};

// 같은 사건을 두 번 적재하지 않기 위한 유일 키 (PrReviewFinding.fingerprint 선례와 같은 방식).
//
// 필요한 이유: autopilot 은 앞 실행이 도는 중에 들어온 재큐를 막지 않는다 — 완주 표식만 보므로
// 겹침이 원리상 가능하고, 그것은 의도적 절충이다(autopilot.orchestrator.ts 의 "알려진 한계").
// 겹친 두 실행은 같은 직전 스냅샷을 읽어 같은 변화를 계산하므로, 지문이 없으면 append-only 인
// 이 표에 같은 매매가 두 줄로 쌓여 회고·통계를 부풀린다.
//
// 하루에 두 번 변한 같은 종목은 수량이 다르므로(오전 200→230, 오후 230→250) 지문도 다르다 —
// 진짜 두 번째 매매가 중복으로 오인돼 사라지지는 않는다.
export interface HoldingChangeFingerprintInput {
  change: HoldingChange;
  effectiveDate: Date;
}

export const buildHoldingChangeFingerprint = ({
  change,
  effectiveDate,
}: HoldingChangeFingerprintInput): string => {
  const source = [
    String(change.tickerId),
    effectiveDate.toISOString().slice(0, 10),
    change.kind,
    change.previousQuantity ?? '',
    change.quantity,
    change.previousAvgPrice ?? '',
    change.avgPrice,
  ].join('\n');
  return createHash('sha256').update(source).digest('hex');
};
