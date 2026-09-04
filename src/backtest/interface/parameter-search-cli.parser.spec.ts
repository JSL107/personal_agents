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
    expect(options.volumeSurgeMinimums).toBeUndefined();
    expect(options.rankingWeights).toBeUndefined();
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

  it('새 검색 축을 목록으로 읽는다', () => {
    const options = parseParameterSearchCliArguments(
      argv(`${REQUIRED} --volume-surge-min 1,1.5,2 --rank-weights 1:1:1,0:1:1`),
    );
    expect(options.volumeSurgeMinimums).toEqual([1, 1.5, 2]);
    expect(options.rankingWeights).toEqual([
      [1, 1, 1],
      [0, 1, 1],
    ]);
  });

  it('순위 가중치 조합은 세 성분·유효한 합을 요구한다', () => {
    for (const value of ['1:1', '-1:1:1', '1::1', '0:0:0']) {
      expect(() =>
        parseParameterSearchCliArguments(
          argv(`${REQUIRED} --rank-weights ${value}`),
        ),
      ).toThrow('--rank-weights');
    }
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

  // 미지정이 빈 배열이 되면 회차가 하나도 안 돌고, 그때 리포트는 "조합이 없다" 가 아니라
  // 그냥 비어 나온다 — 미지정은 미반영 회차 하나여야 한다.
  it('슬리피지를 안 주면 미반영 회차 하나만 돈다', () => {
    expect(
      parseParameterSearchCliArguments(argv(REQUIRED)).slippagePercents,
    ).toEqual([0]);
  });

  it('슬리피지는 목록으로 받는다', () => {
    expect(
      parseParameterSearchCliArguments(argv(`${REQUIRED} --slippage 0,0.1,0.5`))
        .slippagePercents,
    ).toEqual([0, 0.1, 0.5]);
  });

  // 음수는 "유리하게 체결됐다" 는 가정이라 손잡이의 방향 자체가 뒤집힌다.
  it('음수 슬리피지는 받지 않는다', () => {
    expect(() =>
      parseParameterSearchCliArguments(argv(`${REQUIRED} --slippage -0.1`)),
    ).toThrow('--slippage');
  });

  // `Number('')` 은 0 이라, 0 을 받는 축에서는 빈 항목이 "0% 회차" 로 조용히 통과한다.
  it('빈 항목이 섞이면 끊는다', () => {
    expect(() =>
      parseParameterSearchCliArguments(argv(`${REQUIRED} --slippage ,0.1`)),
    ).toThrow('빈 항목');
    expect(() =>
      parseParameterSearchCliArguments(argv(`${REQUIRED} --take-profit 2,`)),
    ).toThrow('빈 항목');
  });

  // 같은 값이 두 번 오면 회차가 둘 생기는데 결과는 한 버킷에 합쳐져 리포트가 부풀려진다.
  it('같은 슬리피지를 두 번 주면 한 회차로 친다', () => {
    expect(
      parseParameterSearchCliArguments(argv(`${REQUIRED} --slippage 0,0.1,0`))
        .slippagePercents,
    ).toEqual([0, 0.1]);
  });
});
