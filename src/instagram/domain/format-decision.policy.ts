import { match } from 'ts-pattern';

import {
  assignArm,
  FORMAT_KNOBS,
  FormatKnob,
  FormatKnobValue,
  FormatPolicy,
} from './format-policy';
import { InsightSnapshot, SnapshotWindow } from './instagram-insight.type';
import { InstagramPost, InstagramPostStatus } from './instagram-post.type';
import type { FormatPolicyRead } from './port/format-policy-store.port';
import { INSIGHT_LOOKBACK_MINUTES } from './snapshot-window.policy';

export const MIN_SAMPLES = 6;
export const MIN_VIEWS = 60;
export const MIN_DIFF_POINTS = 6;
export const P_THRESHOLD = 0.05;
export const WATCH_GUARD_MS = 400;
export const PUBLISH_GAP_POINTS = 15;
export const ABORT_DAYS = 30;
export const WORST_GUARD_SAMPLES = 4;
export const WORST_GUARD_POINTS = 12;
export const PROPOSAL_DECISIONS = 2;
export const EPSILON = 1e-9;
const DAY_MS = 86_400_000;
const DAILY_KEY = /^(\d{4}-\d{2}-\d{2})\/daily$/;

export enum ReelFormatVerdict {
  PROMOTE = 'PROMOTE',
  KEEP = 'KEEP',
  HOLD = 'HOLD',
  ABORT = 'ABORT',
}
export enum ReelFormatDecisionMode {
  PROPOSAL = 'PROPOSAL',
  AUTO = 'AUTO',
}

export interface DecisionHistoryRow {
  experimentId: string;
  knob: FormatKnob;
  championValue: FormatKnobValue | null;
  challengerValue: FormatKnobValue | null;
  verdict: ReelFormatVerdict;
  mode: ReelFormatDecisionMode;
  reverseChallenge: boolean;
  policyVersionAfter: number;
  policyAfter: FormatPolicy | null;
  statsJson: DecisionStatsRecord;
  createdAt: Date;
}
export type ValidDecisionHistoryRow = DecisionHistoryRow & {
  championValue: FormatKnobValue;
  challengerValue: FormatKnobValue;
};
export interface ScoredSample {
  day: string;
  reelKey: string;
  snapshotId: string;
  ageMinutes: number;
  arm: 'champion' | 'challenger';
  skipRate: number;
  avgWatchMs: number | null;
}
export enum ExclusionReason {
  LOST = 'lost',
  ERROR = 'error',
  SKIP_NULL = 'skip_null',
  WATCH_NULL = 'watch_null',
  LOW_VIEWS = 'low_views',
  NO_RECORD = 'no_record',
  ARM_MISMATCH = 'arm_mismatch',
  VALUE_MISMATCH = 'value_mismatch',
  UNREALIZED = 'unrealized',
}
export interface PublishRates {
  championAssigned: number;
  challengerAssigned: number;
  championPublished: number;
  challengerPublished: number;
  championRate: number | null;
  challengerRate: number | null;
  gapPoints: number | null;
}
export interface SampleCollection {
  champion: ScoredSample[];
  challenger: ScoredSample[];
  pendingDays: string[];
  excluded: Record<ExclusionReason, number>;
  publishRates: PublishRates;
}
export interface DecisionStats {
  nChampion: number;
  nChallenger: number;
  championMeanSkip: number | null;
  challengerMeanSkip: number | null;
  championMeanWatchMs: number | null;
  challengerMeanWatchMs: number | null;
  skipDifference: number | null;
  pValue: number | null;
  excluded: Record<ExclusionReason, number>;
  pending: number;
  publishRates: PublishRates;
  samples: ScoredSample[];
}
export interface DecisionStatsRecord {
  nChampion?: number;
  nChallenger?: number;
  championMeanSkip?: number | null;
  challengerMeanSkip?: number | null;
  championMeanWatchMs?: number | null;
  challengerMeanWatchMs?: number | null;
  skipDifference?: number | null;
  pValue?: number | null;
  excluded?: Partial<Record<ExclusionReason, number>>;
  pending?: number;
  publishRates?: Partial<PublishRates>;
  samples?: ScoredSample[];
  nextReverseChallenge?: boolean;
  proposalDecisionNumber?: number | null;
  needsHumanReview?: boolean;
  baselineSkip?: number;
  interruptedExperimentId?: string | null;
}
export interface JudgeResult {
  verdict: ReelFormatVerdict | null;
  reason: string;
  stats: DecisionStats;
}
interface VerdictDecision {
  verdict: ReelFormatVerdict;
  reason: string;
}
export interface FormatCandidate {
  knob: FormatKnob;
  challenger: FormatKnobValue;
  id: string;
}
export interface CandidateList {
  candidates: FormatCandidate[];
  reverseChallenge: boolean;
  needsHumanReview: boolean;
}
export interface WorstGuardResult {
  promoted: ValidDecisionHistoryRow;
  samples: ScoredSample[];
  meanSkip: number;
  baselineSkip: number;
  shouldRevert: boolean;
}

export const permutationPValue = ({
  champion,
  challenger,
}: {
  champion: number[];
  challenger: number[];
}): number => {
  if (champion.length !== MIN_SAMPLES || challenger.length !== MIN_SAMPLES) {
    throw new Error('각 군 6편이 필요합니다.');
  }
  const values = [...champion, ...challenger];
  const observed = mean(champion) - mean(challenger);
  const total = values.reduce((sum, value) => sum + value, 0);
  const allocations = combinations(
    Array.from({ length: values.length }, (_, index) => index),
    MIN_SAMPLES,
  );
  const extreme = allocations.filter((indices) => {
    const challengerTotal = indices.reduce(
      (sum, index) => sum + values[index],
      0,
    );
    const challengerMean = challengerTotal / MIN_SAMPLES;
    const championMean = (total - challengerMean * MIN_SAMPLES) / MIN_SAMPLES;
    return championMean - challengerMean >= observed - EPSILON;
  }).length;
  return extreme / allocations.length;
};

const combinations = (indices: number[], size: number): number[][] => {
  if (size === 0) {
    return [[]];
  }
  if (indices.length < size) {
    return [];
  }
  const [first, ...rest] = indices;
  const withFirst = combinations(rest, size - 1).map((combination) => [
    first,
    ...combination,
  ]);
  const withoutFirst = combinations(rest, size);
  const selections = [...withFirst, ...withoutFirst];
  return selections;
};

export const collectSamples = ({
  policy,
  posts,
  snapshots,
  today,
  now,
  publishedSince,
}: {
  policy: FormatPolicy;
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
  today: string;
  now: Date;
  publishedSince?: Date;
}): SampleCollection => {
  const collection = emptyCollection();
  const experiment = policy.experiment;
  if (!experiment) {
    return collection;
  }
  const byPost = new Map(
    snapshots
      .filter(
        (snapshot) => snapshot.snapshotWindow === SnapshotWindow.AFTER_3_DAYS,
      )
      .map((snapshot) => [snapshot.postId, snapshot]),
  );
  const eligible = posts.filter((post) => {
    if (!isDailyPublished({ post, start: experiment.start, today })) {
      return false;
    }
    if (publishedSince && post.publishedAt! < publishedSince) {
      return false;
    }
    return true;
  });
  for (const post of eligible.sort((left, right) =>
    left.reelKey.localeCompare(right.reelKey),
  )) {
    const day = post.reelKey.slice(0, 10);
    const snapshot = byPost.get(post.id);
    if (!snapshot) {
      const ageMinutes = (now.getTime() - post.publishedAt!.getTime()) / 60_000;
      if (ageMinutes <= INSIGHT_LOOKBACK_MINUTES) {
        collection.pendingDays.push(day);
      } else {
        collection.excluded[ExclusionReason.LOST] += 1;
      }
      continue;
    }
    const reason = exclusionReason({ post, snapshot, policy, day });
    if (reason) {
      collection.excluded[reason] += 1;
      continue;
    }
    const arm = assignArm(policy, day).arm;
    collection[arm].push({
      day,
      reelKey: post.reelKey,
      snapshotId: snapshot.id,
      ageMinutes: snapshot.ageMinutes,
      arm,
      skipRate: snapshot.metrics.skipRate!,
      avgWatchMs: finiteOrNull(snapshot.metrics.avgWatchMs),
    });
  }
  collection.publishRates = countPublishRates({
    policy,
    posts: eligible,
    today,
  });
  return collection;
};

export const judgeExperiment = ({
  policy,
  samples,
  today,
}: {
  policy: FormatPolicy;
  samples: SampleCollection;
  today: string;
}): JudgeResult => {
  const champion = samples.champion.slice(0, MIN_SAMPLES);
  const challenger = samples.challenger.slice(0, MIN_SAMPLES);
  const complete =
    champion.length === MIN_SAMPLES && challenger.length === MIN_SAMPLES;
  const championMeanSkip = complete
    ? mean(champion.map((sample) => sample.skipRate))
    : null;
  const challengerMeanSkip = complete
    ? mean(challenger.map((sample) => sample.skipRate))
    : null;
  const stats: DecisionStats = {
    nChampion: champion.length,
    nChallenger: challenger.length,
    championMeanSkip,
    challengerMeanSkip,
    championMeanWatchMs: meanNullable(
      champion.map((sample) => sample.avgWatchMs),
    ),
    challengerMeanWatchMs: meanNullable(
      challenger.map((sample) => sample.avgWatchMs),
    ),
    skipDifference: null,
    pValue: null,
    excluded: samples.excluded,
    pending: samples.pendingDays.length,
    publishRates: samples.publishRates,
    samples: [...champion, ...challenger],
  };
  if (!policy.experiment) {
    return { verdict: null, reason: 'no_experiment', stats };
  }
  if (!complete) {
    if (dayDifference(policy.experiment.start, today) > ABORT_DAYS) {
      const suffix = publishGapExceeded(samples.publishRates)
        ? ',publish_gap'
        : '';
      return {
        verdict: ReelFormatVerdict.ABORT,
        reason: `timeout${suffix}`,
        stats,
      };
    }
    return { verdict: null, reason: 'insufficient_samples', stats };
  }
  const lastChampionDay = champion[MIN_SAMPLES - 1].day;
  const lastChallengerDay = challenger[MIN_SAMPLES - 1].day;
  const lastDay =
    lastChampionDay > lastChallengerDay ? lastChampionDay : lastChallengerDay;
  if (samples.pendingDays.some((day) => day < lastDay)) {
    return { verdict: null, reason: 'earlier_pending', stats };
  }
  const publishGap = publishGapExceeded(samples.publishRates);
  if (!publishGap) {
    stats.skipDifference = championMeanSkip! - challengerMeanSkip!;
    stats.pValue = permutationPValue({
      champion: champion.map((sample) => sample.skipRate),
      challenger: challenger.map((sample) => sample.skipRate),
    });
  }
  const watchMissing =
    stats.championMeanWatchMs === null || stats.challengerMeanWatchMs === null;
  const watchGuardPassed =
    !watchMissing &&
    stats.challengerMeanWatchMs! >=
      stats.championMeanWatchMs! - WATCH_GUARD_MS - EPSILON;
  const significant =
    stats.pValue !== null &&
    stats.skipDifference !== null &&
    stats.pValue <= P_THRESHOLD &&
    stats.skipDifference >= MIN_DIFF_POINTS - EPSILON;
  const decision: VerdictDecision = match({
    publishGap,
    watchMissing,
    watchGuardPassed,
    significant,
  })
    .with({ publishGap: true }, () => ({
      verdict: ReelFormatVerdict.HOLD,
      reason: 'publish_gap',
    }))
    .with({ watchMissing: true }, () => ({
      verdict: ReelFormatVerdict.KEEP,
      reason: 'watch_missing',
    }))
    .with({ watchGuardPassed: false }, () => ({
      verdict: ReelFormatVerdict.KEEP,
      reason: 'watch_guard',
    }))
    .with({ significant: true }, () => ({
      verdict: ReelFormatVerdict.PROMOTE,
      reason: 'statistically_better',
    }))
    .otherwise(() => ({
      verdict: ReelFormatVerdict.KEEP,
      reason: 'not_significant',
    }));
  return { ...decision, stats };
};

export const decideMode = (
  rows: DecisionHistoryRow[],
): ReelFormatDecisionMode => {
  const count = rows.filter(
    (row) =>
      hasDecisionValues(row) && !isGuardRow(row) && isConclusive(row.verdict),
  ).length;
  if (count < PROPOSAL_DECISIONS) {
    return ReelFormatDecisionMode.PROPOSAL;
  }
  return ReelFormatDecisionMode.AUTO;
};

export const listCandidates = ({
  policy,
  rows,
}: {
  policy: FormatPolicy;
  rows: DecisionHistoryRow[];
}): CandidateList => {
  if (rows.some((row) => !hasDecisionValues(row))) {
    return { candidates: [], reverseChallenge: false, needsHumanReview: true };
  }
  const decisions = rows.filter((row) => !isGuardRow(row));
  const last = decisions.at(-1);
  if (
    last &&
    hasDecisionValues(last) &&
    isReverseChallengeDue({ last, policy, decisions })
  ) {
    return {
      candidates: [toCandidate(last.knob, last.championValue)],
      reverseChallenge: true,
      needsHumanReview: false,
    };
  }
  const pairs = (Object.keys(FORMAT_KNOBS) as FormatKnob[]).flatMap((knob) =>
    FORMAT_KNOBS[knob].map((value) => ({ knob, value })),
  );
  const available = pairs.filter(({ knob, value }) => {
    if (value === policy.champion[knob]) {
      return false;
    }
    const decided = autoDecided({
      rows: decisions,
      knob,
      firstValue: policy.champion[knob],
      secondValue: value,
    });
    return decided === 0;
  });
  const blocked = available.filter(({ knob, value }) => {
    const pairRows = decisions.filter((row) =>
      samePair({
        row,
        knob,
        firstValue: policy.champion[knob],
        secondValue: value,
      }),
    );
    const recent = pairRows.slice(-2);
    const twiceInconclusive =
      recent.length === 2 && recent.every((row) => isInconclusive(row.verdict));
    return twiceInconclusive;
  });
  const blockedKeys = new Set(
    blocked.map(({ knob, value }) =>
      pairKey({ knob, firstValue: policy.champion[knob], secondValue: value }),
    ),
  );
  const candidates = available
    .filter(
      ({ knob, value }) =>
        !blockedKeys.has(
          pairKey({
            knob,
            firstValue: policy.champion[knob],
            secondValue: value,
          }),
        ),
    )
    .map(({ knob, value }) => toCandidate(knob, value));
  const needsHumanReview = blocked.length > 0;
  return { candidates, reverseChallenge: false, needsHumanReview };
};

export const checkWorstGuard = ({
  policy,
  rows,
  posts,
  snapshots,
  today,
  now,
}: {
  policy: FormatPolicy;
  rows: DecisionHistoryRow[];
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
  today: string;
  now: Date;
}): WorstGuardResult | null => {
  const promoted = findActivePromotion({ policy, rows });
  if (!promoted) {
    return null;
  }
  const baselineSkip = promoted.statsJson.championMeanSkip;
  if (typeof baselineSkip !== 'number' || !Number.isFinite(baselineSkip)) {
    return null;
  }
  const byPost = new Map(
    snapshots
      .filter(
        (snapshot) => snapshot.snapshotWindow === SnapshotWindow.AFTER_3_DAYS,
      )
      .map((snapshot) => [snapshot.postId, snapshot]),
  );
  const selected: ScoredSample[] = [];
  const pending: string[] = [];
  for (const post of posts
    .filter((item) =>
      isDailyPublished({ post: item, start: '0000-01-01', today }),
    )
    .sort((a, b) => a.reelKey.localeCompare(b.reelKey))) {
    const record = post.features?.experiment;
    if (
      !record ||
      record.policyVersion < promoted.policyVersionAfter ||
      record.values[promoted.knob] !== promoted.challengerValue ||
      !record.realized
    ) {
      continue;
    }
    const snapshot = byPost.get(post.id);
    if (!snapshot) {
      if (
        (now.getTime() - post.publishedAt!.getTime()) / 60_000 <=
        INSIGHT_LOOKBACK_MINUTES
      ) {
        pending.push(post.reelKey.slice(0, 10));
      }
      continue;
    }
    if (
      snapshot.error ||
      snapshot.metrics.skipRate === null ||
      !Number.isFinite(snapshot.metrics.skipRate) ||
      snapshot.metrics.views === null ||
      snapshot.metrics.views < MIN_VIEWS
    ) {
      continue;
    }
    selected.push({
      day: post.reelKey.slice(0, 10),
      reelKey: post.reelKey,
      snapshotId: snapshot.id,
      ageMinutes: snapshot.ageMinutes,
      arm: record.arm,
      skipRate: snapshot.metrics.skipRate,
      avgWatchMs: finiteOrNull(snapshot.metrics.avgWatchMs),
    });
  }
  if (selected.length < WORST_GUARD_SAMPLES) {
    return null;
  }
  const samples = selected.slice(0, WORST_GUARD_SAMPLES);
  if (pending.some((day) => day < samples[WORST_GUARD_SAMPLES - 1].day)) {
    return null;
  }
  const meanSkip = mean(samples.map((sample) => sample.skipRate));
  return {
    promoted,
    samples,
    meanSkip,
    baselineSkip,
    shouldRevert: meanSkip > baselineSkip + WORST_GUARD_POINTS,
  };
};

export const planRecovery = ({
  state,
  rows,
}: {
  state: FormatPolicyRead;
  rows: DecisionHistoryRow[];
}): FormatPolicy | null => {
  const latest = [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
  if (!latest) {
    return null;
  }
  if (!latest.policyAfter || !hasDecisionValues(latest)) {
    return null;
  }
  if (state.kind === 'missing') {
    return latest.policyAfter;
  }
  if (
    state.kind !== 'ok' ||
    state.policy.version >= latest.policyVersionAfter
  ) {
    return null;
  }
  return latest.policyAfter;
};

export const nextChampion = ({
  policy,
  verdict,
  mode,
}: {
  policy: FormatPolicy;
  verdict: ReelFormatVerdict | null;
  mode: ReelFormatDecisionMode;
}): FormatPolicy['champion'] => {
  const champion = { ...policy.champion };
  if (
    verdict === ReelFormatVerdict.PROMOTE &&
    mode === ReelFormatDecisionMode.AUTO &&
    policy.experiment
  ) {
    champion[policy.experiment.knob] = policy.experiment.challenger;
  }
  return champion;
};

export const buildNextPolicy = ({
  policy,
  verdict,
  mode,
  candidate,
  today,
}: {
  policy: FormatPolicy;
  verdict: ReelFormatVerdict | null;
  mode: ReelFormatDecisionMode;
  candidate: FormatCandidate | null;
  today: string;
}): FormatPolicy => {
  const champion = nextChampion({ policy, verdict, mode });
  const start = addDays(today, 1);
  const experiment = candidate
    ? {
        id: `${candidate.knob}-${start}`,
        knob: candidate.knob,
        challenger: candidate.challenger,
        start,
      }
    : null;
  return {
    version: policy.version + 1,
    frozen: policy.frozen,
    champion,
    experiment,
  };
};

const emptyCollection = (): SampleCollection => ({
  champion: [],
  challenger: [],
  pendingDays: [],
  excluded: {
    [ExclusionReason.LOST]: 0,
    [ExclusionReason.ERROR]: 0,
    [ExclusionReason.SKIP_NULL]: 0,
    [ExclusionReason.WATCH_NULL]: 0,
    [ExclusionReason.LOW_VIEWS]: 0,
    [ExclusionReason.NO_RECORD]: 0,
    [ExclusionReason.ARM_MISMATCH]: 0,
    [ExclusionReason.VALUE_MISMATCH]: 0,
    [ExclusionReason.UNREALIZED]: 0,
  },
  publishRates: {
    championAssigned: 0,
    challengerAssigned: 0,
    championPublished: 0,
    challengerPublished: 0,
    championRate: null,
    challengerRate: null,
    gapPoints: null,
  },
});
const isDailyPublished = ({
  post,
  start,
  today,
}: {
  post: InstagramPost;
  start: string;
  today: string;
}): boolean => {
  const match = DAILY_KEY.exec(post.reelKey);
  if (
    !match ||
    post.status !== InstagramPostStatus.PUBLISHED ||
    !post.publishedAt
  ) {
    return false;
  }
  const day = match[1];
  const inWindow = day >= start && day < today;
  return inWindow;
};
const exclusionReason = ({
  post,
  snapshot,
  policy,
  day,
}: {
  post: InstagramPost;
  snapshot: InsightSnapshot;
  policy: FormatPolicy;
  day: string;
}): ExclusionReason | null => {
  if (snapshot.error) {
    return ExclusionReason.ERROR;
  }
  if (
    snapshot.metrics.skipRate === null ||
    !Number.isFinite(snapshot.metrics.skipRate)
  ) {
    return ExclusionReason.SKIP_NULL;
  }
  // 시청 가드도 판정 표본 6편 전부로 본다. 값이 빈 영상을 남기면 1편만으로 가드를 통과할 수 있다.
  if (
    snapshot.metrics.avgWatchMs === null ||
    !Number.isFinite(snapshot.metrics.avgWatchMs)
  ) {
    return ExclusionReason.WATCH_NULL;
  }
  if (snapshot.metrics.views === null || snapshot.metrics.views < MIN_VIEWS) {
    return ExclusionReason.LOW_VIEWS;
  }
  const record = post.features?.experiment;
  const experiment = policy.experiment!;
  if (
    !record ||
    record.experimentId !== experiment.id ||
    record.knob !== experiment.knob
  ) {
    return ExclusionReason.NO_RECORD;
  }
  const assignment = assignArm(policy, day);
  if (record.arm !== assignment.arm) {
    return ExclusionReason.ARM_MISMATCH;
  }
  if (record.values[experiment.knob] !== assignment.values[experiment.knob]) {
    return ExclusionReason.VALUE_MISMATCH;
  }
  if (!record.realized) {
    return ExclusionReason.UNREALIZED;
  }
  return null;
};
const countPublishRates = ({
  policy,
  posts,
  today,
}: {
  policy: FormatPolicy;
  posts: InstagramPost[];
  today: string;
}): PublishRates => {
  const rates = emptyCollection().publishRates;
  const published = new Set(posts.map((post) => post.reelKey.slice(0, 10)));
  for (
    let day = policy.experiment!.start;
    day <= addDays(today, -4);
    day = addDays(day, 1)
  ) {
    const arm = assignArm(policy, day).arm;
    if (arm === 'champion') {
      rates.championAssigned += 1;
      if (published.has(day)) {
        rates.championPublished += 1;
      }
    } else {
      rates.challengerAssigned += 1;
      if (published.has(day)) {
        rates.challengerPublished += 1;
      }
    }
  }
  if (rates.championAssigned > 0 && rates.challengerAssigned > 0) {
    rates.championRate =
      (100 * rates.championPublished) / rates.championAssigned;
    rates.challengerRate =
      (100 * rates.challengerPublished) / rates.challengerAssigned;
    rates.gapPoints = Math.abs(rates.championRate - rates.challengerRate);
  }
  return rates;
};
const publishGapExceeded = (rates: PublishRates): boolean =>
  rates.gapPoints !== null && rates.gapPoints > PUBLISH_GAP_POINTS;
const mean = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const meanNullable = (values: (number | null)[]): number | null => {
  const finite = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (finite.length === 0) {
    return null;
  }
  return mean(finite);
};
const finiteOrNull = (value: number | null): number | null =>
  value !== null && Number.isFinite(value) ? value : null;
const dayDifference = (from: string, to: string): number =>
  (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
const addDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
const isConclusive = (verdict: string): boolean =>
  verdict === ReelFormatVerdict.PROMOTE || verdict === ReelFormatVerdict.KEEP;
const isInconclusive = (verdict: string): boolean =>
  verdict === ReelFormatVerdict.HOLD || verdict === ReelFormatVerdict.ABORT;
export const isGuardRow = (row: DecisionHistoryRow): boolean => {
  const guardRow = row.experimentId.startsWith('guard-');
  return guardRow;
};
export const hasDecisionValues = (
  row: DecisionHistoryRow,
): row is ValidDecisionHistoryRow => {
  const valid = row.championValue !== null && row.challengerValue !== null;
  return valid;
};
export const isAutoPromotion = (
  row: DecisionHistoryRow,
): row is ValidDecisionHistoryRow => {
  const autoPromotion =
    hasDecisionValues(row) &&
    row.verdict === ReelFormatVerdict.PROMOTE &&
    row.mode === ReelFormatDecisionMode.AUTO &&
    !isGuardRow(row);
  return autoPromotion;
};
const isReverseChallengeDue = ({
  last,
  policy,
  decisions,
}: {
  last: DecisionHistoryRow;
  policy: FormatPolicy;
  decisions: DecisionHistoryRow[];
}): boolean => {
  if (!hasDecisionValues(last)) {
    return false;
  }
  const undecidedReverse =
    isAutoPromotion(last) &&
    !last.reverseChallenge &&
    policy.champion[last.knob] === last.challengerValue &&
    autoDecided({
      rows: decisions,
      knob: last.knob,
      firstValue: last.championValue,
      secondValue: last.challengerValue,
    }) === 1;
  return undecidedReverse;
};
const findActivePromotion = ({
  policy,
  rows,
}: {
  policy: FormatPolicy;
  rows: DecisionHistoryRow[];
}): ValidDecisionHistoryRow | null => {
  const promoted = [...rows].reverse().find(isAutoPromotion);
  if (!promoted) {
    return null;
  }
  if (policy.champion[promoted.knob] !== promoted.challengerValue) {
    return null;
  }
  const guardAlreadyRecorded = rows.some(
    (row) => row.experimentId === `guard-${promoted.experimentId}`,
  );
  if (guardAlreadyRecorded) {
    return null;
  }
  return promoted;
};
interface PairValues {
  knob: FormatKnob;
  firstValue: FormatKnobValue;
  secondValue: FormatKnobValue;
}
const pairKey = ({ knob, firstValue, secondValue }: PairValues): string => {
  const values = [
    JSON.stringify(firstValue),
    JSON.stringify(secondValue),
  ].sort();
  const key = JSON.stringify([knob, values]);
  return key;
};
const samePair = ({
  row,
  knob,
  firstValue,
  secondValue,
}: PairValues & { row: DecisionHistoryRow }): boolean => {
  if (!hasDecisionValues(row)) {
    return false;
  }
  const requestedKey = pairKey({ knob, firstValue, secondValue });
  const rowKey = pairKey({
    knob: row.knob,
    firstValue: row.championValue,
    secondValue: row.challengerValue,
  });
  const identical = requestedKey === rowKey;
  return identical;
};
const autoDecided = ({
  rows,
  knob,
  firstValue,
  secondValue,
}: {
  rows: DecisionHistoryRow[];
} & PairValues): number => {
  const count = rows.filter(
    (row) =>
      row.mode === ReelFormatDecisionMode.AUTO &&
      isConclusive(row.verdict) &&
      samePair({ row, knob, firstValue, secondValue }),
  ).length;
  return count;
};
const toCandidate = (
  knob: FormatKnob,
  challenger: FormatKnobValue,
): FormatCandidate => ({
  knob,
  challenger,
  id: `${knob}=${JSON.stringify(challenger)}`,
});
