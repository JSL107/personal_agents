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
// 정수로 환산해 비교하니 부동소수 동등 비교 문제도 함께 사라진다.
const STORED_SCALE = 10_000;

const atStoredScale = (value: DecimalValue): number =>
  Math.round(value.toNumber() * STORED_SCALE);

const compare = (
  before: HoldingPosition,
  after: HoldingPosition,
): HoldingChange | null => {
  const beforeQuantity = atStoredScale(before.quantity);
  const afterQuantity = atStoredScale(after.quantity);
  const beforeAvgPrice = atStoredScale(before.avgPrice);
  const afterAvgPrice = atStoredScale(after.avgPrice);

  const base = {
    tickerId: after.tickerId,
    tickerName: after.tickerName,
    symbol: after.symbol,
    previousQuantity: before.quantity.toString(),
    quantity: after.quantity.toString(),
    previousAvgPrice: before.avgPrice.toString(),
    avgPrice: after.avgPrice.toString(),
    currency: after.currency,
  };

  if (afterQuantity === 0) {
    // 브로커가 0 수량 종목을 그대로 실어 보내는 경우. 응답에서 빠지는 경로와 같은 사건이다.
    return beforeQuantity === 0 ? null : { ...base, kind: 'SOLD_ALL' };
  }
  if (afterQuantity > beforeQuantity) {
    return { ...base, kind: 'INCREASED' };
  }
  if (afterQuantity < beforeQuantity) {
    return { ...base, kind: 'DECREASED' };
  }
  // 수량이 같은데 평단이 움직였다 — 같은 날 사고팔아 수량이 되돌아왔거나 브로커가 재계산했다.
  // 수량 변화에 딸린 평단 변화는 INCREASED/DECREASED 안에 이미 담겨 있으므로 여기서 다루지 않는다.
  if (afterAvgPrice !== beforeAvgPrice) {
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
      if (atStoredScale(position.quantity) === 0) {
        continue;
      }
      changes.push({
        tickerId: position.tickerId,
        tickerName: position.tickerName,
        symbol: position.symbol,
        kind: 'BOUGHT',
        previousQuantity: null,
        quantity: position.quantity.toString(),
        previousAvgPrice: null,
        avgPrice: position.avgPrice.toString(),
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
      previousQuantity: before.quantity.toString(),
      quantity: '0',
      previousAvgPrice: before.avgPrice.toString(),
      avgPrice: before.avgPrice.toString(),
      currency: before.currency,
    });
  }

  return changes;
};
