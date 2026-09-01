import { ScreenUniverseResult } from '../application/screen-universe.usecase';

const formatNullable = (value: number | null, suffix: string): string =>
  value === null ? '-' : `${value.toFixed(2)}${suffix}`;

const formatTurnover60 = (value: number | null): string =>
  value === null
    ? '-'
    : Math.round(value / 100_000_000).toLocaleString('en-US');

// 계수를 만들어 놓고 화면에 안 내면 보는 사람에게는 없는 것과 같다 — 종가로 대신한 봉이
// 섞여 신고가 위치가 부풀려진 후보가 있어도 정상 결과처럼 읽힌다. 통과 0건 분기에도 붙이는
// 것은 통과 여부와 이 값이 무관하기 때문이다(순위에 오른 후보 전체를 세므로).
//
// 0 일 때는 적지 않는다. 운영 유니버스는 폐지 종목을 보지 않고 기준일이 다른 종목도 빠져
// 구조적으로 0 이라, 매 회차 `0종목` 을 붙이면 읽을 것이 없는 줄이 늘 뿐이다. 값이 있는
// 회차에만 나타나는 편이 그 자체로 신호가 된다.
const formatHighFallback = (result: ScreenUniverseResult): string =>
  result.highFallbackCount === 0
    ? ''
    : `, 고가 결측 종가대체 ${result.highFallbackCount.toLocaleString('en-US')}종목(신고가 위치 부풀려짐)`;

export const formatScreenResult = (result: ScreenUniverseResult): string => {
  if (result.passedCount === 0) {
    return (
      `스크리닝 통과 종목이 없습니다. 유니버스 ${result.universeCount.toLocaleString('en-US')}종목 중 봉이 있는 것 ${result.evaluatedCount.toLocaleString('en-US')}종목, 기준일 제외 ${result.staleCount.toLocaleString('en-US')}종목, 통과 0건입니다.` +
      formatHighFallback(result)
    );
  }

  const strategyHeaders =
    result.strategy === 'LONG_TERM'
      ? 'return6m\tvolatility20'
      : 'volumeSurge\treturn1m';
  const lines = result.stocks.map((stock, index) => {
    const strategyValues =
      result.strategy === 'LONG_TERM'
        ? `${formatNullable(stock.indicators.return6m, '%')}\t${formatNullable(stock.indicators.volatility20, '%')}`
        : `${formatNullable(stock.indicators.volumeSurge, 'x')}\t${formatNullable(stock.indicators.return1m, '%')}`;
    return `${index + 1}\t${stock.code}\t${stock.name}\t${stock.krxMarket ?? '-'}\t${stock.score.toFixed(2)}\t${formatTurnover60(stock.indicators.turnover60)}\t${strategyValues}`;
  });
  return [
    `스크리닝 결과 — ${result.strategy}, 규칙 v${result.ruleVersion}, 기준일 ${result.asOf ?? '-'}, 기준일 제외 ${result.staleCount.toLocaleString('en-US')}종목, 통과 ${result.passedCount.toLocaleString('en-US')}종목` +
      formatHighFallback(result),
    `순위\t종목코드\t종목명\t시장\t점수\tturnover60(억원)\t${strategyHeaders}`,
    ...lines,
  ].join('\n');
};
