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
