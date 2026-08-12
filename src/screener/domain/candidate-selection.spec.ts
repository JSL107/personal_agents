import {
  MINIMUM_TURNOVER,
  selectLongTermCandidates,
  selectSwingCandidates,
} from './candidate-selection';
import { StockIndicator } from './indicator.type';

const buildIndicator = (
  overrides: Partial<StockIndicator> & { code: string },
): StockIndicator => ({
  tickerId: Number(overrides.code),
  name: `종목${overrides.code}`,
  krxMarket: 'KOSPI',
  lastTradeDate: '2026-08-11',
  lastClose: 1_000,
  barCount: 200,
  ma5: 1_000,
  ma20: 1_000,
  ma60: 1_000,
  ma120: 1_000,
  isAligned: false,
  isUptrend: true,
  disparity20: 1,
  volumeSurge: 1,
  return20: 0,
  return60: 0,
  return120: 0,
  high200Position: 1,
  volatility20: 0.01,
  turnover60: MINIMUM_TURNOVER,
  ...overrides,
});

describe('selectLongTermCandidates', () => {
  it('중장기 상승 종목을 120일 수익률 내림차순으로 고른다', () => {
    const indicators = [
      buildIndicator({ code: '000001', return120: 0.1 }),
      buildIndicator({ code: '000002', return120: 0.5 }),
      buildIndicator({ code: '000003', return120: 0.3 }),
    ];

    const selected = selectLongTermCandidates(indicators, 2);

    expect(selected.map((candidate) => candidate.code)).toEqual([
      '000002',
      '000003',
    ]);
  });

  it('중장기 상승이 아닌 종목은 수익률이 높아도 제외한다', () => {
    const indicators = [
      buildIndicator({ code: '000001', return120: 0.9, isUptrend: false }),
      buildIndicator({ code: '000002', return120: 0.1 }),
    ];

    const selected = selectLongTermCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000002']);
  });

  it('거래대금 하한 미만은 제외한다', () => {
    const indicators = [
      buildIndicator({
        code: '000001',
        return120: 0.9,
        turnover60: MINIMUM_TURNOVER - 1,
      }),
      buildIndicator({ code: '000002', return120: 0.1 }),
    ];

    const selected = selectLongTermCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000002']);
  });

  it('입력 배열을 변형하지 않는다', () => {
    const indicators = [
      buildIndicator({ code: '000001', return120: 0.1 }),
      buildIndicator({ code: '000002', return120: 0.5 }),
    ];

    selectLongTermCandidates(indicators, 2);

    expect(indicators.map((indicator) => indicator.code)).toEqual([
      '000001',
      '000002',
    ]);
  });
});

describe('selectSwingCandidates', () => {
  it('거래량 급증 상위 풀 안에서 20일 수익률 순으로 고른다', () => {
    // 급증 배수 순서와 수익률 순서를 어긋나게 두어 2차 정렬이 도는지 본다.
    const indicators = [
      buildIndicator({ code: '000001', volumeSurge: 5, return20: 0.1 }),
      buildIndicator({ code: '000002', volumeSurge: 4, return20: 0.3 }),
      buildIndicator({ code: '000003', volumeSurge: 3, return20: 0.2 }),
    ];

    const selected = selectSwingCandidates(indicators, 2);

    expect(selected.map((candidate) => candidate.code)).toEqual([
      '000002',
      '000003',
    ]);
  });

  it('급증 상위 100종 밖의 종목은 수익률이 높아도 뽑히지 않는다', () => {
    const pool = Array.from({ length: 100 }, (_, index) =>
      buildIndicator({
        code: String(index + 1).padStart(6, '0'),
        volumeSurge: 100 - index / 1_000,
        return20: 0.01,
      }),
    );
    const outsider = buildIndicator({
      code: '999999',
      volumeSurge: 1,
      return20: 0.9,
    });

    const selected = selectSwingCandidates([...pool, outsider], 5);

    expect(selected.map((candidate) => candidate.code)).not.toContain('999999');
  });

  it('중장기 하락이어도 단타 후보가 될 수 있다', () => {
    const indicators = [
      buildIndicator({
        code: '000001',
        isUptrend: false,
        volumeSurge: 5,
        return20: 0.3,
      }),
    ];

    const selected = selectSwingCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000001']);
  });

  it('거래대금 하한 미만은 제외한다', () => {
    const indicators = [
      buildIndicator({
        code: '000001',
        volumeSurge: 9,
        return20: 0.9,
        turnover60: MINIMUM_TURNOVER - 1,
      }),
      buildIndicator({ code: '000002', volumeSurge: 2, return20: 0.1 }),
    ];

    const selected = selectSwingCandidates(indicators, 5);

    expect(selected.map((candidate) => candidate.code)).toEqual(['000002']);
  });
});
