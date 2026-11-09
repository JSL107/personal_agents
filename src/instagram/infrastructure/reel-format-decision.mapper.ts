import { ReelFormatDecision as ReelFormatDecisionRow } from '@prisma/client';
import { isMatching, P } from 'ts-pattern';

import {
  ExclusionReason,
  ReelFormatDecisionMode,
  ReelFormatDecisionReason,
  ReelFormatVerdict,
} from '../domain/format-decision.policy';
import {
  FORMAT_KNOBS,
  FormatKnobValue,
  isFormatKnob,
  isFormatPolicy,
} from '../domain/format-policy';
import { ReelFormatLedgerCorruptedException } from '../domain/instagram.exception';
import { ReelFormatDecision } from '../domain/port/reel-format-decision.repository.port';

const SAMPLE_PATTERN = {
  day: P.string,
  reelKey: P.string,
  snapshotId: P.string,
  ageMinutes: P.number,
  arm: P.union('champion', 'challenger'),
  skipRate: P.number,
  avgWatchMs: P.union(P.number, null),
};
const EXCLUDED_PATTERN = {
  [ExclusionReason.LOST]: P.number,
  [ExclusionReason.ERROR]: P.number,
  [ExclusionReason.SKIP_NULL]: P.number,
  [ExclusionReason.WATCH_NULL]: P.number,
  [ExclusionReason.LOW_VIEWS]: P.number,
  [ExclusionReason.NO_RECORD]: P.number,
  [ExclusionReason.ARM_MISMATCH]: P.number,
  [ExclusionReason.VALUE_MISMATCH]: P.number,
  [ExclusionReason.UNREALIZED]: P.number,
};
const PUBLISH_RATES_PATTERN = {
  championAssigned: P.number,
  challengerAssigned: P.number,
  championPublished: P.number,
  challengerPublished: P.number,
  championRate: P.union(P.number, null),
  challengerRate: P.union(P.number, null),
  gapPoints: P.union(P.number, null),
};
const STATS_PATTERN = P.union(
  {
    kind: 'judgment',
    nChampion: P.number,
    nChallenger: P.number,
    championMeanSkip: P.union(P.number, null),
    challengerMeanSkip: P.union(P.number, null),
    championMeanWatchMs: P.union(P.number, null),
    challengerMeanWatchMs: P.union(P.number, null),
    skipDifference: P.union(P.number, null),
    pValue: P.union(P.number, null),
    excluded: EXCLUDED_PATTERN,
    pending: P.number,
    publishRates: PUBLISH_RATES_PATTERN,
    samples: P.array(SAMPLE_PATTERN),
    nextReverseChallenge: P.boolean,
    proposalDecisionNumber: P.union(P.number, null),
    needsHumanReview: P.boolean,
  },
  {
    kind: 'guard',
    meanSkip: P.number,
    baselineSkip: P.number,
    samples: P.array(SAMPLE_PATTERN),
    interruptedExperimentId: P.union(P.string, null),
    nextReverseChallenge: P.boolean,
    needsHumanReview: P.boolean,
  },
);
const AI_PROPOSAL_PATTERN = P.union(
  null,
  { error: P.string },
  {
    candidateId: P.optional(P.string),
    hypothesis: P.string,
    interpretation: P.string,
    raw: P.string,
  },
);

const isVerdict = (value: string): value is ReelFormatVerdict =>
  Object.values(ReelFormatVerdict).some((verdict) => verdict === value);
const isMode = (value: string): value is ReelFormatDecisionMode =>
  Object.values(ReelFormatDecisionMode).some((mode) => mode === value);
const isDecisionReason = (value: string): value is ReelFormatDecisionReason =>
  Object.values(ReelFormatDecisionReason).some((reason) => reason === value);
const KNOB_VALUE_PATTERN = P.union(P.boolean, P.string, P.number);
const ROW_PATTERN = {
  knob: P.when(isFormatKnob),
  championValue: KNOB_VALUE_PATTERN,
  challengerValue: KNOB_VALUE_PATTERN,
  statsJson: STATS_PATTERN,
  verdict: P.when(isVerdict),
  mode: P.when(isMode),
  reason: P.when(isDecisionReason),
  policyAfter: P.when(isFormatPolicy),
  aiProposal: AI_PROPOSAL_PATTERN,
};

export const toReelFormatDecision = (
  row: ReelFormatDecisionRow,
): ReelFormatDecision => {
  if (!isMatching(ROW_PATTERN, row)) {
    throw new ReelFormatLedgerCorruptedException([row.id]);
  }
  const allowed: readonly FormatKnobValue[] = FORMAT_KNOBS[row.knob];
  if (
    !allowed.includes(row.championValue) ||
    !allowed.includes(row.challengerValue)
  ) {
    throw new ReelFormatLedgerCorruptedException([row.id]);
  }
  return row;
};
