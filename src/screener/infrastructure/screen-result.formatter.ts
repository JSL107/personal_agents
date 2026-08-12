import { ScreenUniverseResult } from '../application/screen-universe.usecase';

const formatNullable = (value: number | null, suffix: string): string =>
  value === null ? '-' : `${value.toFixed(2)}${suffix}`;

export const formatScreenResult = (result: ScreenUniverseResult): string => {
  if (result.passedCount === 0) {
    return `스크리닝 통과 종목이 없습니다. 유니버스 ${result.universeCount.toLocaleString('en-US')}종목 중 봉이 있는 것 ${result.evaluatedCount.toLocaleString('en-US')}종목, 통과 0건입니다.`;
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
    return `${index + 1}\t${stock.code}\t${stock.name}\t${stock.krxMarket ?? '-'}\t${stock.score.toFixed(2)}\t${strategyValues}`;
  });
  return [
    `스크리닝 결과 — ${result.strategy}, 규칙 v${result.ruleVersion}, 기준일 ${result.asOf ?? '-'}, 통과 ${result.passedCount.toLocaleString('en-US')}종목`,
    `순위\t종목코드\t종목명\t시장\t점수\t${strategyHeaders}`,
    ...lines,
  ].join('\n');
};
