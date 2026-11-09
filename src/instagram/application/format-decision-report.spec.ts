import {
  ReelFormatDecisionMode,
  ReelFormatVerdict,
} from '../domain/format-decision.policy';
import { ReelFormatDecision } from '../domain/port/reel-format-decision.repository.port';
import { formatReelFormatDecisionReport } from './format-decision-report';

const decision: ReelFormatDecision = {
  id: 'row-1',
  experimentId: 'early_card-2026-11-10',
  knob: 'early_card',
  championValue: false,
  challengerValue: true,
  nChampion: 6,
  nChallenger: 6,
  excluded: 2,
  statsJson: {
    championMeanSkip: 70,
    challengerMeanSkip: 62,
    skipDifference: 8,
    pValue: 0.01,
    championMeanWatchMs: 2100,
    challengerMeanWatchMs: 2300,
    publishRates: { championRate: 90, challengerRate: 90 },
    excluded: { low_views: 2 },
    pending: 1,
    proposalDecisionNumber: 1,
  },
  verdict: ReelFormatVerdict.PROMOTE,
  mode: ReelFormatDecisionMode.PROPOSAL,
  reverseChallenge: false,
  reason: 'significant',
  policyVersionBefore: 1,
  policyVersionAfter: 2,
  policyAfter: {
    version: 2,
    frozen: false,
    champion: { early_card: false },
    experiment: {
      id: 'early_card-2026-11-26',
      knob: 'early_card',
      challenger: true,
      start: '2026-11-26',
    },
  },
  aiProposal: {
    hypothesis: '효과를 확인한다',
    interpretation: '<새 후보> 효과를 확인한다.',
    raw: '{}',
  },
  decidedAt: new Date('2026-11-25T00:00:00Z'),
  reportedAt: null,
  createdAt: new Date('2026-11-25T00:00:00Z'),
};

describe('formatReelFormatDecisionReport', () => {
  it('복구 정책이 손상된 원장 행은 적용 보고를 만들지 않는다', () => {
    const report = formatReelFormatDecisionReport({
      ...decision,
      policyAfter: null,
    });

    expect(report).toBeNull();
  });

  it('대결 값이 손상된 원장 행은 적용 보고를 만들지 않는다', () => {
    const report = formatReelFormatDecisionReport({
      ...decision,
      challengerValue: null,
    });

    expect(report).toBeNull();
  });

  it('원장 행만으로 판정과 적용 결과를 다시 그린다', () => {
    const report = formatReelFormatDecisionReport(decision);

    expect(report).toContain('early_card-2026-11-10');
    expect(report).toContain('제안 모드 1/2');
    expect(report).toContain('champion 6편 / challenger 6편');
    expect(report).toContain('low_views 2');
    expect(report).toContain('v1→v2');
    expect(report).toContain('early_card-2026-11-26');
    expect(report).toContain('&lt;새 후보&gt;');
  });

  it('AI 실패와 가드 복귀도 행에 남은 값으로 표시한다', () => {
    const report = formatReelFormatDecisionReport({
      ...decision,
      experimentId: 'guard-early_card-2026-11-10',
      verdict: ReelFormatVerdict.ABORT,
      mode: ReelFormatDecisionMode.AUTO,
      reason: 'worst_guard',
      statsJson: { ...decision.statsJson, interruptedExperimentId: 'next-1' },
      aiProposal: { error: 'timeout' },
    });

    expect(report).toContain('AI 실패');
    expect(report).toContain('중단된 실험: next-1');
  });
});
