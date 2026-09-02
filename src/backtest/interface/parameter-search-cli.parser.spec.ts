import { parseParameterSearchCliArguments } from './parameter-search-cli.parser';

const argv = (text: string): string[] => text.split(' ').filter(Boolean);
const REQUIRED = '--from 2021-10-01 --to 2026-08-31';

describe('parseParameterSearchCliArguments', () => {
  it('구간만 주면 창 6개월·이동 6개월·두 전략으로 돈다', () => {
    const options = parseParameterSearchCliArguments(argv(REQUIRED));

    expect(options).toMatchObject({
      strategies: ['LONG_TERM', 'SWING'],
      from: '2021-10-01',
      to: '2026-08-31',
      windowMonths: 6,
      stepMonths: 6,
      includeBandless: false,
    });
  });

  it('축을 안 준 자리는 undefined 로 남는다', () => {
    // 파서가 기본값을 박으면 "미지정" 과 "우연히 현행값과 같은 값을 명시" 가 구분되지
    // 않아, 활성 행이 무엇이든 늘 같은 격자를 돌게 된다.
    const options = parseParameterSearchCliArguments(argv(REQUIRED));

    expect(options.takeProfitPercents).toBeUndefined();
    expect(options.stopLossPercents).toBeUndefined();
    expect(options.minimumTurnover60s).toBeUndefined();
    expect(options.maximumWeightPercents).toBeUndefined();
  });

  it('쉼표로 이어 붙인 후보를 목록으로 읽는다', () => {
    const options = parseParameterSearchCliArguments(
      argv(
        `${REQUIRED} --take-profit 2,5,10 --stop-loss -0.2,-5 --weight 15,20`,
      ),
    );

    expect(options.takeProfitPercents).toEqual([2, 5, 10]);
    expect(options.stopLossPercents).toEqual([-0.2, -5]);
    expect(options.maximumWeightPercents).toEqual([15, 20]);
  });

  it('익절은 양수·손절은 음수만 받는다', () => {
    expect(() =>
      parseParameterSearchCliArguments(argv(`${REQUIRED} --take-profit -5`)),
    ).toThrow('--take-profit');
    expect(() =>
      parseParameterSearchCliArguments(argv(`${REQUIRED} --stop-loss 5`)),
    ).toThrow('--stop-loss');
  });

  it('값 없이 플래그만 오면 다음 플래그를 값으로 먹지 않는다', () => {
    expect(() =>
      parseParameterSearchCliArguments(
        argv('--from --to 2026-08-31 --take-profit 10'),
      ),
    ).toThrow('--from 에 값이 필요합니다');
  });

  it('없는 날짜는 형식만 맞아도 거른다', () => {
    // 2026-02-30 은 형식이 맞아 통과하고 new Date 가 3월로 넘긴다.
    expect(() =>
      parseParameterSearchCliArguments(
        argv('--from 2026-02-30 --to 2026-08-31'),
      ),
    ).toThrow('실제 존재하는 날짜');
  });

  it('from 이 to 보다 늦으면 끊는다', () => {
    expect(() =>
      parseParameterSearchCliArguments(
        argv('--from 2026-08-31 --to 2021-10-01'),
      ),
    ).toThrow('--from 이 --to 보다 늦습니다');
  });

  it('슬리피지는 축이 아니라 전 조합에 물리는 고정값이다', () => {
    // 축으로 순회하면 "어느 조합이 나은가" 와 "얼마나 불리해지면 무너지나" 가 한 표에 섞인다.
    expect(
      parseParameterSearchCliArguments(argv(`${REQUIRED} --slippage 0.2`))
        .slippagePercent,
    ).toBe(0.2);
    expect(
      parseParameterSearchCliArguments(argv(REQUIRED)).slippagePercent,
    ).toBe(0);
    expect(() =>
      parseParameterSearchCliArguments(argv(`${REQUIRED} --slippage 100`)),
    ).toThrow('--slippage');
  });

  it('모르는 전략은 받지 않는다', () => {
    expect(() =>
      parseParameterSearchCliArguments(
        argv(`${REQUIRED} --strategy DAY_TRADE`),
      ),
    ).toThrow('--strategy');
  });

  it('전략을 중복해 주면 한 번만 돈다', () => {
    const options = parseParameterSearchCliArguments(
      argv(`${REQUIRED} --strategy SWING,SWING`),
    );

    expect(options.strategies).toEqual(['SWING']);
  });
});
