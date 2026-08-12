import { RankCandidatesResult } from '../application/rank-candidates.usecase';
import { StockIndicator } from '../domain/indicator.type';

const percent = (ratio: number): string => {
  return `${(ratio * 100).toFixed(1)}%`;
};

const billion = (amount: number): string => {
  return `${(amount / 100_000_000).toFixed(0)}억`;
};

const formatRow = (candidate: StockIndicator, rank: number): string => {
  return [
    String(rank).padStart(2, ' '),
    candidate.code,
    candidate.name.slice(0, 12).padEnd(12, ' '),
    `종가 ${candidate.lastClose.toLocaleString('ko-KR')}`,
    `20일 ${percent(candidate.return20)}`,
    `120일 ${percent(candidate.return120)}`,
    `급증 ${candidate.volumeSurge.toFixed(2)}배`,
    `고가대비 ${percent(candidate.high200Position)}`,
    `거래대금 ${billion(candidate.turnover60)}`,
  ].join('  ');
};

const formatSection = (
  title: string,
  candidates: StockIndicator[],
): string[] => {
  if (candidates.length === 0) {
    return [`${title}: 없음`, ''];
  }
  return [
    `${title} ${candidates.length}종`,
    ...candidates.map((candidate, index) => formatRow(candidate, index + 1)),
    '',
  ];
};

export const formatCandidates = (result: RankCandidatesResult): string => {
  return [
    `유니버스 ${result.universeCount}종목 — 평가 ${result.evaluatedCount}, 제외 ${result.skippedCount}(봉 부족)`,
    '',
    ...formatSection('장투 후보', result.longTerm),
    ...formatSection('단타 후보', result.swing),
  ].join('\n');
};
