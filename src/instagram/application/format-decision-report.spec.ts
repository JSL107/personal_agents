import {
  ExclusionReason,
  ReelFormatDecisionMode,
  ReelFormatDecisionReason,
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
    kind: 'judgment',
    nChampion: 6,
    nChallenger: 6,
    championMeanSkip: 70,
    challengerMeanSkip: 62,
    skipDifference: 8,
    pValue: 0.01,
    championMeanWatchMs: 2100,
    challengerMeanWatchMs: 2300,
    publishRates: {
      championAssigned: 10,
      challengerAssigned: 10,
      championPublished: 9,
      challengerPublished: 9,
      championRate: 90,
      challengerRate: 90,
      gapPoints: 0,
    },
    excluded: {
      [ExclusionReason.LOST]: 0,
      [ExclusionReason.ERROR]: 0,
      [ExclusionReason.SKIP_NULL]: 0,
      [ExclusionReason.WATCH_NULL]: 0,
      [ExclusionReason.LOW_VIEWS]: 2,
      [ExclusionReason.NO_RECORD]: 0,
      [ExclusionReason.ARM_MISMATCH]: 0,
      [ExclusionReason.VALUE_MISMATCH]: 0,
      [ExclusionReason.UNREALIZED]: 0,
    },
    pending: 1,
    proposalDecisionNumber: 1,
    nextReverseChallenge: false,
    needsHumanReview: false,
    samples: [],
  },
  verdict: ReelFormatVerdict.PROMOTE,
  mode: ReelFormatDecisionMode.PROPOSAL,
  reverseChallenge: false,
  reason: ReelFormatDecisionReason.STATISTICALLY_BETTER,
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
      reason: ReelFormatDecisionReason.WORST_GUARD,
      statsJson: {
        kind: 'guard',
        meanSkip: 88,
        baselineSkip: 70,
        samples: [],
        interruptedExperimentId: 'next-1',
        nextReverseChallenge: false,
        needsHumanReview: false,
      },
      aiProposal: { error: 'timeout' },
    });

    expect(report).toContain('AI 실패');
    expect(report).toContain('평균 스킵률: champion 88.00%');
    expect(report).toContain('중단된 실험: next-1');
  });

  it('게시율 격차를 동반한 기간 초과 사유는 기존 보고 문구로 표시한다', () => {
    const report = formatReelFormatDecisionReport({
      ...decision,
      reason: ReelFormatDecisionReason.TIMEOUT_PUBLISH_GAP,
    });

    expect(report).toContain('사유 timeout,publish_gap');
  });
});
