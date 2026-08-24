const ROUND_HALF_UP = 4;

export interface ExposureDecimal {
  mul(value: string | number): ExposureDecimal;
  plus(value: string | number): ExposureDecimal;
  dividedBy(value: string | number): ExposureDecimal;
  lessThanOrEqualTo(value: string | number): boolean;
  comparedTo(value: string | number): number;
  toDecimalPlaces(decimalPlaces: number, roundingMode: 4): ExposureDecimal;
  toNumber(): number;
  toString(): string;
}

export interface ExposurePosition {
  region: string | null;
  direction: string;
  currency: string;
  quantity: ExposureDecimal;
  close: ExposureDecimal;
}

// 평가 요약은 노출 계산보다 두 가지를 더 본다 — 평단(손익)과 직전 종가(전 거래일 대비).
// 노출 쪽에는 필요 없는 값이라 별도 타입으로 얹는다.
export interface ValuedPosition extends ExposurePosition {
  avgPrice: ExposureDecimal;
  // 최신 봉 직전 거래일의 종가. 봉이 하나뿐이면 null 이고, 그때는 전일 대비를 내지 않는다.
  previousClose: ExposureDecimal | null;
}

export interface PortfolioValue {
  // 전부 원화 환산 후의 값이다.
  totalValue: number;
  // 평단 대비 누적 손익.
  profit: number;
  profitRate: number;
  // 직전 거래일 종가 대비. 봉이 하나뿐인 종목이 있으면 null 이다 — 일부만 더한 값은
  // "어제 얼마 움직였나" 로 읽히면서 실제와 다르다.
  dailyChange: number | null;
  dailyChangeRate: number | null;
}

export interface ExposureBucket {
  label: string;
  ratio: number;
}

export interface PortfolioExposure {
  buckets: ExposureBucket[];
  fxUsdRatio: number;
}

interface CalculatedExposureBucket {
  label: string;
  value: ExposureDecimal;
}

export const calculatePortfolioExposure = (
  positions: ExposurePosition[],
  usdKrwRate: ExposureDecimal | null,
): PortfolioExposure | null => {
  const hasUsdPosition = positions.some(
    (position) => position.currency === 'USD',
  );
  if (hasUsdPosition && !usdKrwRate) {
    return null;
  }

  const bucketValues = new Map<string, ExposureDecimal>();
  let totalValue: ExposureDecimal | null = null;
  let usdExposureValue: ExposureDecimal | null = null;

  for (const position of positions) {
    const positionValue = calculatePositionValue(position, usdKrwRate);
    const label = calculateExposureLabel(position);
    const bucketValue = bucketValues.get(label);

    bucketValues.set(
      label,
      bucketValue ? bucketValue.plus(positionValue.toString()) : positionValue,
    );
    totalValue = totalValue
      ? totalValue.plus(positionValue.toString())
      : positionValue;
    // region은 원화 표시 해외 ETF의 기초자산 노출을, currency는 미분류 USD 포지션의 직접 환노출을 포착한다.
    if (position.region === 'US' || position.currency === 'USD') {
      usdExposureValue = usdExposureValue
        ? usdExposureValue.plus(positionValue.toString())
        : positionValue;
    }
  }

  if (!totalValue || totalValue.lessThanOrEqualTo(0)) {
    return null;
  }

  const buckets = buildExposureBuckets(bucketValues, totalValue);

  // ponytail: 환헤지 상품을 구분하지 않는다(현재 보유에 헤지형이 없다). 헤지형이 생기면 Ticker 에 플래그 컬럼을 추가한다.
  const fxUsdRatio = usdExposureValue
    ? calculateRoundedRatio(usdExposureValue, totalValue)
    : 0;

  return { buckets, fxUsdRatio };
};

// 알림은 이상할 때만 울린다. 아무 일 없는 날에도 자산이 얼마이고 얼마 벌었는지는 알아야 한다.
// USD 보유가 있는데 환율이 없으면 null 을 낸다 — 국내분만 더한 값을 "총자산" 으로 부르면
// 실제보다 작은 숫자가 매일 아침 사실처럼 도착한다. 노출 계산이 쓰는 판정과 같은 기준이다.
export const summarizePortfolioValue = (
  positions: ValuedPosition[],
  usdKrwRate: ExposureDecimal | null,
): PortfolioValue | null => {
  const hasUsdPosition = positions.some(
    (position) => position.currency === 'USD',
  );
  if (positions.length === 0 || (hasUsdPosition && !usdKrwRate)) {
    return null;
  }

  let totalValue: ExposureDecimal | null = null;
  let totalCost: ExposureDecimal | null = null;
  let previousValue: ExposureDecimal | null = null;
  // 한 종목이라도 직전 봉이 없으면 전일 대비를 아예 내지 않는다. 그 종목만 빼고 더하면
  // 변화량은 작아지는데 비율은 남은 종목 기준이라, 둘이 서로 다른 표본을 가리키게 된다.
  let canCompareDaily = true;

  for (const position of positions) {
    const value = calculatePositionValue(position, usdKrwRate);
    const cost = convertToKrw(
      position.quantity.mul(position.avgPrice.toString()),
      position.currency,
      usdKrwRate,
    );
    totalValue = totalValue ? totalValue.plus(value.toString()) : value;
    totalCost = totalCost ? totalCost.plus(cost.toString()) : cost;

    if (position.previousClose === null) {
      canCompareDaily = false;
      continue;
    }
    // 환율은 최신 값 하나로 고정한다. 두 시점 환율을 쓰면 주가 변동과 환율 변동이 한 숫자에
    // 섞여 "어제 장이 어땠나" 를 못 읽는다. 그래서 이 값은 환차손익을 뺀 주가 변동분이다.
    const previous = convertToKrw(
      position.quantity.mul(position.previousClose.toString()),
      position.currency,
      usdKrwRate,
    );
    previousValue = previousValue
      ? previousValue.plus(previous.toString())
      : previous;
  }

  if (!totalValue || !totalCost || totalCost.lessThanOrEqualTo(0)) {
    return null;
  }

  const profit = totalValue.toNumber() - totalCost.toNumber();
  const dailyBase =
    canCompareDaily && previousValue ? previousValue.toNumber() : null;

  return {
    totalValue: totalValue.toNumber(),
    profit,
    profitRate: profit / totalCost.toNumber(),
    dailyChange: dailyBase === null ? null : totalValue.toNumber() - dailyBase,
    dailyChangeRate:
      dailyBase === null || dailyBase === 0
        ? null
        : (totalValue.toNumber() - dailyBase) / dailyBase,
  };
};

const convertToKrw = (
  value: ExposureDecimal,
  currency: string,
  usdKrwRate: ExposureDecimal | null,
): ExposureDecimal => {
  if (currency !== 'USD') {
    return value;
  }
  return value.mul(usdKrwRate!.toString());
};

const calculatePositionValue = (
  position: ExposurePosition,
  usdKrwRate: ExposureDecimal | null,
): ExposureDecimal => {
  const value = position.quantity.mul(position.close.toString());
  if (position.currency !== 'USD') {
    return value;
  }

  return value.mul(usdKrwRate!.toString());
};

const calculateExposureLabel = (position: ExposurePosition): string => {
  if (position.region === 'US' && position.direction === 'LONG') {
    return '미국 주식';
  }
  if (position.region === 'US' && position.direction === 'SHORT') {
    return '미국 하락 베팅';
  }
  if (position.region === 'KR' && position.direction === 'LONG') {
    return '한국 주식';
  }
  if (position.region === 'KR' && position.direction === 'SHORT') {
    return '코스피 하락 베팅';
  }

  return '미분류';
};

const buildExposureBuckets = (
  bucketValues: Map<string, ExposureDecimal>,
  totalValue: ExposureDecimal,
): ExposureBucket[] => {
  const calculatedBuckets: CalculatedExposureBucket[] = [];
  for (const [label, value] of bucketValues) {
    calculatedBuckets.push({ label, value });
  }

  calculatedBuckets.sort((left, right) =>
    right.value.comparedTo(left.value.toString()),
  );

  // 반올림으로 합이 100 이 아닐 수 있다. 표시용 근사값이므로 보정하지 않는다.
  return calculatedBuckets.map(({ label, value }) => ({
    label,
    ratio: calculateRoundedRatio(value, totalValue),
  }));
};

const calculateRoundedRatio = (
  value: ExposureDecimal,
  totalValue: ExposureDecimal,
): number => {
  return value
    .dividedBy(totalValue.toString())
    .mul(100)
    .toDecimalPlaces(0, ROUND_HALF_UP)
    .toNumber();
};
