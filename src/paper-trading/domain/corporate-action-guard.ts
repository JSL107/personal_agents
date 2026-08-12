import { MoneyValue } from '../../market-data/domain/market-data.type';

export interface PriceJumpInput {
  tickerId: number;
  previousClose: MoneyValue;
  currentClose: MoneyValue;
}

export interface PriceJumpSuspicion {
  tickerId: number;
  ratio: string;
  suspectedRatio: string;
}

// 국내 액면분할에서 반복적으로 쓰이는 정수비만 본다. 임의의 모든 정수를 허용하면
// 큰 폭의 실제 하락도 가까운 비율을 찾아 오탐하므로 상식적인 후보로 범위를 제한한다.
const SPLIT_RATIO_CANDIDATES = ['2', '3', '4', '5', '10', '20', '50', '100'];
// 분할 기준가는 정수비에 맞지만 당일 가격 변동은 생길 수 있다. 5%는 그 작은 변동을
// 허용하면서도 계획의 일반 급락 예시(-35%, 2:1 기준에서 30% 이탈)는 구분하는 범위다.
const SPLIT_RATIO_TOLERANCE = '0.05';

const absoluteDifference = (left: MoneyValue, right: MoneyValue): MoneyValue =>
  left.comparedTo(right) >= 0 ? left.minus(right) : right.minus(left);

const findSuspectedRatio = (input: PriceJumpInput): string | null => {
  let closestRatio: string | null = null;
  let closestDistance: MoneyValue | null = null;

  for (const candidate of SPLIT_RATIO_CANDIDATES) {
    const expectedClose = input.previousClose.dividedBy(candidate);
    const relativeDistance = absoluteDifference(
      input.currentClose,
      expectedClose,
    ).dividedBy(expectedClose);
    if (relativeDistance.comparedTo(SPLIT_RATIO_TOLERANCE) > 0) {
      continue;
    }
    if (
      closestDistance === null ||
      relativeDistance.comparedTo(closestDistance) < 0
    ) {
      closestRatio = candidate;
      closestDistance = relativeDistance;
    }
  }

  return closestRatio;
};

export const detectSuspiciousPriceJump = (
  inputs: PriceJumpInput[],
): PriceJumpSuspicion[] => {
  const suspicions: PriceJumpSuspicion[] = [];

  for (const input of inputs) {
    if (input.previousClose.comparedTo(0) <= 0) {
      continue;
    }
    const suspectedRatio = findSuspectedRatio(input);
    if (suspectedRatio === null) {
      continue;
    }
    suspicions.push({
      tickerId: input.tickerId,
      ratio: input.currentClose.dividedBy(input.previousClose).toString(),
      suspectedRatio,
    });
  }

  return suspicions;
};
