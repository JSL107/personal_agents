import { match, P } from 'ts-pattern';

import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { DecisionStatsRecord } from '../domain/format-decision.policy';
import {
  ReelFormatAiProposal,
  ReelFormatDecision,
} from '../domain/port/reel-format-decision.repository.port';

const formatValue = (value: unknown): string => {
  const serialized = JSON.stringify(value) ?? String(value);
  return escapeSlackMrkdwn(serialized);
};

const formatNumber = (value: number | null | undefined, digits = 2): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  return value.toFixed(digits);
};

const formatWatchSeconds = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—';
  }
  const seconds = value / 1000;
  return seconds.toFixed(2);
};

const formatExclusions = (value: DecisionStatsRecord['excluded']): string => {
  if (!value) {
    return '없음';
  }
  const counts = Object.entries(value)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason} ${count}`);
  if (counts.length === 0) {
    return '없음';
  }
  return counts.join('·');
};

const formatAi = (value: ReelFormatAiProposal): string => {
  const interpretation = match(value)
    .with(null, () => 'AI 제안 없음')
    .with({ error: '' }, () => 'AI 제안 없음')
    .with({ error: P.string }, () => 'AI 실패')
    .with({ interpretation: P.string }, (proposal) =>
      escapeSlackMrkdwn(proposal.interpretation),
    )
    .exhaustive();
  return interpretation;
};

export const formatReelFormatDecisionReport = (
  decision: ReelFormatDecision,
): string | null => {
  if (
    decision.policyAfter === null ||
    decision.championValue === null ||
    decision.challengerValue === null
  ) {
    return null;
  }
  const stats = decision.statsJson;
  const experiment = decision.policyAfter.experiment;
  const nextExperiment = experiment
    ? `${experiment.id} (${experiment.knob}=${formatValue(experiment.challenger)})`
    : '없음';
  const beforeChampion = formatValue(decision.championValue);
  const afterChampion = formatValue(
    decision.policyAfter.champion[decision.knob],
  );
  const rates = stats.publishRates;
  const mode =
    decision.mode === 'PROPOSAL'
      ? `제안 모드 ${String(stats.proposalDecisionNumber ?? '—')}/2 — 실험 영상은 실제로 만들어지지만 판정 결과는 적용하지 않음`
      : '자동 적용';
  const lines = [
    `🎞️ 릴스 형식 판정 · ${escapeSlackMrkdwn(decision.experimentId)}`,
    `대결: ${escapeSlackMrkdwn(decision.knob)} ${beforeChampion} ↔ ${formatValue(decision.challengerValue)}`,
    `판정: ${escapeSlackMrkdwn(decision.verdict)} · ${mode} · 사유 ${escapeSlackMrkdwn(decision.reason)}`,
    `표본: champion ${decision.nChampion}편 / challenger ${decision.nChallenger}편 · 제외 ${decision.excluded}편 (${formatExclusions(stats.excluded)}) · pending ${String(stats.pending ?? 0)}편`,
    `평균 스킵률: champion ${formatNumber(stats.championMeanSkip)}% / challenger ${formatNumber(stats.challengerMeanSkip)}% · 차이 ${formatNumber(stats.skipDifference)}%p · p ${formatNumber(stats.pValue, 4)}`,
    `평균 시청: champion ${formatWatchSeconds(stats.championMeanWatchMs)}초 / challenger ${formatWatchSeconds(stats.challengerMeanWatchMs)}초`,
    `게시율: champion ${formatNumber(rates?.championRate)}% / challenger ${formatNumber(rates?.challengerRate)}%`,
    `적용: v${decision.policyVersionBefore}→v${decision.policyVersionAfter} · champion ${beforeChampion}→${afterChampion}`,
    `다음 실험: ${nextExperiment}`,
    `AI 해석: ${formatAi(decision.aiProposal)}`,
  ];
  if (stats.needsHumanReview === true) {
    lines.push('같은 대결이 연속 보류·중단 — 사람 확인 필요');
  }
  if (decision.reason === 'worst_guard') {
    lines.push(
      `중단된 실험: ${escapeSlackMrkdwn(String(stats.interruptedExperimentId ?? '없음'))}`,
    );
  }
  return lines.join('\n');
};
