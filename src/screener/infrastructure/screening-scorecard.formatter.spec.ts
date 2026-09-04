import { BuildScreeningScorecardResult } from '../application/build-screening-scorecard.usecase';
import {
  buildScorecardHorizon,
  ScreeningScorecardRow,
} from '../domain/screening-scorecard';
import {
  formatScreeningScorecard,
  formatScreeningScorecardDetail,
} from './screening-scorecard.formatter';

const row = (
  overrides: Partial<ScreeningScorecardRow> = {},
): ScreeningScorecardRow => ({
  strategy: 'SWING',
  ruleVersion: 2,
  runId: 1,
  rank: 1,
  presented: true,
  returnPct: 0,
  bought: false,
  tickerCode: '000000',
  tickerName: '테스트',
  ...overrides,
});

const result = (
  rows: ScreeningScorecardRow[],
  pendingRunCount = 0,
): BuildScreeningScorecardResult => ({
  asOf: new Date('2026-08-31T00:00:00.000Z'),
  horizons: [
    buildScorecardHorizon({
      horizonDays: 5,
      rows,
      newlyScoredCount: rows.length,
      pendingRunCount,
    }),
    buildScorecardHorizon({
      horizonDays: 20,
      rows: [],
      newlyScoredCount: 0,
      pendingRunCount: 14,
    }),
  ],
});

describe('formatScreeningScorecard', () => {
  it('산 것과 안 산 것을 나란히 세우고 격차를 적는다', () => {
    const text = formatScreeningScorecard(
      result([
        row({ bought: true, returnPct: 10, rank: 1 }),
        row({ bought: false, returnPct: 4, rank: 2 }),
      ]),
    );

    expect(text).toContain('*5거래일 지평* — 표본 2건 (보여준 것 2건)');
    expect(text).toContain('산 것    1건 · 평균 +10.00%');
    expect(text).toContain('안 산 것 1건 · 평균 +4.00%');
    expect(text).toContain('격차 +6.00%p');
  });

  it('상한 밖 갈래를 따로 세우고 절단 격차를 적는다', () => {
    const text = formatScreeningScorecard(
      result([
        row({ presented: true, bought: true, returnPct: 10, rank: 1 }),
        row({ presented: true, bought: false, returnPct: 4, rank: 2 }),
        row({ presented: false, bought: false, returnPct: -20, rank: 21 }),
      ]),
    );

    // 헤더의 표본 수가 비교 모집단처럼 읽히지 않게 둘을 나눠 적는다.
    expect(text).toContain('*5거래일 지평* — 표본 3건 (보여준 것 2건)');
    expect(text).toContain('상한 밖  1건 · 평균 -20.00%');
    // 보여준 것 평균(+7.00%) − 상한 밖 평균(-20.00%).
    expect(text).toContain(
      '절단 격차 +27.00%p (회차 1개 평균, 보여준 것 − 상한 밖)',
    );
    // 상한 밖 성적이 대조군에 새면 이 줄이 -8.00% 로 나온다.
    expect(text).toContain('안 산 것 1건 · 평균 +4.00%');
  });

  // 상한 밖 표본이 0 이어도 줄을 빼지 않는다. 빼면 저장이 고장난 것과 아직 안 쌓인 것을
  // 읽는 사람이 가릴 수 없다.
  it('상한 밖 표본이 없으면 해당 없음으로 남기고 격차는 적지 않는다', () => {
    const text = formatScreeningScorecard(
      result([row({ presented: true, bought: true, returnPct: 10 })]),
    );

    expect(text).toContain('상한 밖  0건 — 해당 없음');
    expect(text).not.toContain('절단 격차');
  });

  // 표본이 없는 지평을 목록에서 빼면 그 축이 조용히 사라져, 아직 안 온 것과 채점이
  // 고장난 것을 읽는 사람이 가릴 수 없다.
  it('표본 없는 지평도 축을 남기고 대기 회차 수를 밝힌다', () => {
    const text = formatScreeningScorecard(result([row({ returnPct: 1 })]));

    expect(text).toContain('*20거래일 지평* — 표본 없음 (채점 대기 회차 14건)');
    // 빈칸이나 0% 같은 값이 그 자리에 나가면 안 된다.
    expect(text).not.toContain('*20거래일 지평* — 표본 0건');
    expect(text).not.toMatch(/20거래일 지평\*[^\n]*평균/u);
  });

  it('결론 문장은 격차 부호를 그대로 따른다', () => {
    const better = formatScreeningScorecard(
      result([
        row({ bought: true, returnPct: 10 }),
        row({ bought: false, returnPct: 1 }),
      ]),
    );
    expect(better).toContain('→ 전 전략 그렇다');

    const worse = formatScreeningScorecard(
      result([
        row({ bought: true, returnPct: 1 }),
        row({ bought: false, returnPct: 10 }),
      ]),
    );
    expect(worse).toContain('→ 전 전략 아니다');

    const mixed = formatScreeningScorecard(
      result([
        row({ strategy: 'SWING', bought: true, returnPct: 10 }),
        row({ strategy: 'SWING', bought: false, returnPct: 1 }),
        row({ strategy: 'LONG_TERM', bought: true, returnPct: 1 }),
        row({ strategy: 'LONG_TERM', bought: false, returnPct: 10 }),
      ]),
    );
    expect(mixed).toContain('→ 갈림: 나은 쪽 SWING');
  });

  // 격차가 정확히 0 인데 결론에 "아니다" 가 적히면 표와 어긋난다.
  it('격차 0 은 나쁜 쪽으로 몰지 않는다', () => {
    const allTied = formatScreeningScorecard(
      result([
        row({ bought: true, returnPct: 5 }),
        row({ bought: false, returnPct: 5 }),
      ]),
    );
    expect(allTied).toContain('격차 0.00%p');
    expect(allTied).toContain('→ 갈림: 나은 쪽 없음(나머지는 동률)');
    expect(allTied).not.toContain('전 전략 아니다');

    const oneTied = formatScreeningScorecard(
      result([
        row({ strategy: 'SWING', bought: true, returnPct: 5 }),
        row({ strategy: 'SWING', bought: false, returnPct: 5 }),
        row({ strategy: 'LONG_TERM', bought: true, returnPct: 1 }),
        row({ strategy: 'LONG_TERM', bought: false, returnPct: 9 }),
      ]),
    );
    expect(oneTied).toContain('→ 갈림: 나은 쪽 없음(나머지는 동률)');
    expect(oneTied).not.toContain('전 전략 아니다');
  });

  // 부동소수 잔여로 gap 이 2.8e-17 이 되면 표는 `+0.00%p` 인데 결론만 "나았다" 로 갈린다.
  it('표시 자리에서 0 인 격차는 나은 쪽으로 세지 않는다', () => {
    const text = formatScreeningScorecard(
      result([
        row({ bought: true, returnPct: 0.1 }),
        row({ bought: true, returnPct: 0.2 }),
        row({ bought: false, returnPct: 0.15 }),
      ]),
    );

    expect(text).toContain('격차 0.00%p');
    expect(text).not.toContain('격차 +0.00%p');
    expect(text).not.toContain('전 전략 그렇다');
    expect(text).toContain('나은 쪽 없음(나머지는 동률)');
  });

  // 비교 불가 전략을 빼고 세면서 "전 전략" 이라 적으면 결론이 표보다 넓게 읽힌다.
  it('비교 불가 전략이 섞이면 결론의 모집단을 밝힌다', () => {
    const text = formatScreeningScorecard(
      result([
        row({ strategy: 'SWING', bought: true, returnPct: 9 }),
        row({ strategy: 'SWING', bought: false, returnPct: 1 }),
        row({ strategy: 'LONG_TERM', bought: true, returnPct: 3 }),
      ]),
    );

    expect(text).toContain('비교 가능한 1/2개 전략 그렇다');
    expect(text).not.toContain('전 전략 그렇다');
  });

  it('한쪽에 표본이 없으면 격차 자리에 이유를 적는다', () => {
    const text = formatScreeningScorecard(
      result([row({ bought: true, returnPct: 7 })]),
    );

    expect(text).toContain('안 산 것 0건 — 해당 없음');
    expect(text).toContain('격차 - — 한쪽에 표본이 없어 비교 대상이 없음');
  });

  it('산 것 표본이 10건 미만이면 추세가 아니라고 적는다', () => {
    const thin = formatScreeningScorecard(
      result([
        row({ bought: true, returnPct: 1 }),
        row({ bought: false, returnPct: 1 }),
      ]),
    );
    expect(thin).toContain('이 격차는 아직 추세가 아닙니다');

    const enough = formatScreeningScorecard(
      result([
        ...Array.from({ length: 10 }, () =>
          row({ bought: true, returnPct: 1 }),
        ),
        row({ bought: false, returnPct: 1 }),
      ]),
    );
    expect(enough).not.toContain('이 격차는 아직 추세가 아닙니다');
  });
});

describe('formatScreeningScorecardDetail', () => {
  it('극단 사례에 분모를 붙여 절삭이 아님을 드러낸다', () => {
    const detail = formatScreeningScorecardDetail(
      result([
        row({
          bought: false,
          returnPct: 33.5,
          tickerCode: '001210',
          tickerName: '금호전기',
        }),
        row({ bought: false, returnPct: 1 }),
        row({
          bought: true,
          returnPct: -11.45,
          tickerCode: '085620',
          tickerName: '미래에셋생명',
        }),
      ]),
    );

    expect(detail).toContain('금호전기(001210) 순위 1위 +33.50% — 2건 중 1건');
    expect(detail).toContain(
      '미래에셋생명(085620) 순위 1위 -11.45% — 1건 중 1건',
    );
  });

  it('표본이 전혀 없으면 상세를 내지 않는다', () => {
    expect(formatScreeningScorecardDetail(result([]))).toBeNull();
  });
});
