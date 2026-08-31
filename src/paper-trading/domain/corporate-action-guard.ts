import { MoneyValue } from '../../market-data/domain/market-data.type';

export interface PriceJumpInput {
  tickerId: number;
  previousClose: MoneyValue;
  currentClose: MoneyValue;
}

export interface PriceJumpSuspicion {
  tickerId: number;
  ratio: string;
}

// 국내 주식의 하루 가격제한은 ±30% 다. 그 밖으로 나간 변동은 실거래로 만들 수 없으므로
// 분할·병합·배당락 같은 기업행동이거나 시세 오류이고, 어느 쪽이든 그 가격으로 장부를
// 움직여서는 안 된다.
//
// 옛 판정은 정수비 분할(2·3·5·10…)만 후보로 두고 5% 오차 안에 드는지를 봤다. 그래서
// 2026-08-28 코람코더원리츠의 주당 8,640원 배당락(10,930원 → 2,335원)을 놓쳤다 —
// 배당락 계수 4.773 은 후보에 없고, 가장 가까운 4:1·5:1 과의 오차가 각각 14.5%·6.8%
// 라 허용 범위 밖이었다. 그날 장마감 평가는 이 종목을 정상으로 보고 스냅샷을 적재했다.
//
// 분할비를 맞히려 들지 않고 비율이 제한 밖인지만 보면 기업행동의 종류를 가리지 않는다.
// 정리매매나 신규 상장처럼 가격제한이 다르게 적용되는 종목은 오탐이 날 수 있지만,
// 오탐의 결과는 평가·손절 보류와 경보라서 안전한 방향이다.
const PRICE_LIMIT_LOWER_RATIO = '0.7';
const PRICE_LIMIT_UPPER_RATIO = '1.3';

export const detectSuspiciousPriceJump = (
  inputs: PriceJumpInput[],
): PriceJumpSuspicion[] => {
  const suspicions: PriceJumpSuspicion[] = [];

  for (const input of inputs) {
    if (input.previousClose.comparedTo(0) <= 0) {
      continue;
    }
    const ratio = input.currentClose.dividedBy(input.previousClose);
    if (
      ratio.comparedTo(PRICE_LIMIT_LOWER_RATIO) >= 0 &&
      ratio.comparedTo(PRICE_LIMIT_UPPER_RATIO) <= 0
    ) {
      continue;
    }
    suspicions.push({
      tickerId: input.tickerId,
      ratio: ratio.toString(),
    });
  }

  return suspicions;
};

// 경보 문구를 한곳에 둔다. 평가와 장중 손절이 같은 사건을 다른 말로 알리면 원장을 볼 때
// 같은 종목의 같은 사건인지 알아볼 수 없다.
export const describeSuspiciousPriceJump = (
  suspicion: PriceJumpSuspicion,
  tickerLabel: string,
): string =>
  `${tickerLabel} 가격이 전일 대비 ${suspicion.ratio}배로 변했습니다 — ` +
  `하루 가격제한(±30%) 밖이라 분할·병합·배당락 또는 시세 오류로 봅니다.`;
