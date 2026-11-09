import {
  assignArm,
  FORMAT_KNOBS,
  FormatKnob,
  FormatKnobValue,
  FormatPolicy,
} from './format-policy';
import { InsightSnapshot, SnapshotWindow } from './instagram-insight.type';
import { InstagramPost, InstagramPostStatus } from './instagram-post.type';
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
  knob: string;
  championValue: FormatKnobValue;
  challengerValue: FormatKnobValue;
  verdict: ReelFormatVerdict | string;
  mode: ReelFormatDecisionMode | string;
  reverseChallenge: boolean;
  policyVersionAfter: number;
  policyAfter: FormatPolicy;
  statsJson: Record<string, unknown>;
  createdAt: Date;
}
export interface ScoredSample {
  day: string;
  reelKey: string;
  snapshotId: string;
  ageMinutes: number;
  arm: 'champion' | 'challenger';
  skipRate: number;
  avgWatchMs: number | null;
}
export type ExclusionReason =
  | 'lost'
  | 'error'
  | 'skip_null'
  | 'watch_null'
  | 'low_views'
  | 'no_record'
  | 'arm_mismatch'
  | 'value_mismatch'
  | 'unrealized';
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
export interface JudgeResult {
  verdict: ReelFormatVerdict | null;
  reason: string;
  stats: DecisionStats;
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
  promoted: DecisionHistoryRow;
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
  let extreme = 0;
  let count = 0;
  for (let a = 0; a < 7; a += 1) {
    for (let b = a + 1; b < 8; b += 1) {
      for (let c = b + 1; c < 9; c += 1) {
        for (let d = c + 1; d < 10; d += 1) {
          for (let e = d + 1; e < 11; e += 1) {
            for (let f = e + 1; f < 12; f += 1) {
              const challengerMean =
                (values[a] +
                  values[b] +
                  values[c] +
                  values[d] +
                  values[e] +
                  values[f]) /
                MIN_SAMPLES;
              const championMean =
                (total - challengerMean * MIN_SAMPLES) / MIN_SAMPLES;
              if (championMean - challengerMean >= observed - EPSILON) {
                extreme += 1;
              }
              count += 1;
            }
          }
        }
      }
    }
  }
  return extreme / count;
};

export const collectSamples = ({
  policy,
  posts,
  snapshots,
  today,
  now,
}: {
  policy: FormatPolicy;
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
  today: string;
  now: Date;
}): SampleCollection => {
  const result = emptyCollection();
  const experiment = policy.experiment;
  if (!experiment) {
    return result;
  }
  const byPost = new Map(
    snapshots
      .filter(
        (snapshot) => snapshot.snapshotWindow === SnapshotWindow.AFTER_3_DAYS,
      )
      .map((snapshot) => [snapshot.postId, snapshot]),
  );
  const eligible = posts.filter((post) =>
    isDailyPublished({ post, start: experiment.start, today }),
  );
  for (const post of eligible.sort((left, right) =>
    left.reelKey.localeCompare(right.reelKey),
  )) {
    const day = post.reelKey.slice(0, 10);
    const snapshot = byPost.get(post.id);
    if (!snapshot) {
      const ageMinutes = (now.getTime() - post.publishedAt!.getTime()) / 60_000;
      if (ageMinutes <= INSIGHT_LOOKBACK_MINUTES) {
        result.pendingDays.push(day);
      } else {
        result.excluded.lost += 1;
      }
      continue;
    }
    const reason = exclusionReason({ post, snapshot, policy, day });
    if (reason) {
      result.excluded[reason] += 1;
      continue;
    }
    const arm = assignArm(policy, day).arm;
    result[arm].push({
      day,
      reelKey: post.reelKey,
      snapshotId: snapshot.id,
      ageMinutes: snapshot.ageMinutes,
      arm,
      skipRate: snapshot.metrics.skipRate!,
      avgWatchMs: finiteOrNull(snapshot.metrics.avgWatchMs),
    });
  }
  result.publishRates = countPublishRates({ policy, posts: eligible, today });
  return result;
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
  const lastDay =
    champion[5].day > challenger[5].day ? champion[5].day : challenger[5].day;
  if (samples.pendingDays.some((day) => day < lastDay)) {
    return { verdict: null, reason: 'earlier_pending', stats };
  }
  if (publishGapExceeded(samples.publishRates)) {
    return { verdict: ReelFormatVerdict.HOLD, reason: 'publish_gap', stats };
  }
  stats.skipDifference = championMeanSkip! - challengerMeanSkip!;
  stats.pValue = permutationPValue({
    champion: champion.map((sample) => sample.skipRate),
    challenger: challenger.map((sample) => sample.skipRate),
  });
  if (
    stats.championMeanWatchMs === null ||
    stats.challengerMeanWatchMs === null
  ) {
    return { verdict: ReelFormatVerdict.KEEP, reason: 'watch_missing', stats };
  }
  if (
    stats.challengerMeanWatchMs <
    stats.championMeanWatchMs - WATCH_GUARD_MS - EPSILON
  ) {
    return { verdict: ReelFormatVerdict.KEEP, reason: 'watch_guard', stats };
  }
  if (
    stats.pValue <= P_THRESHOLD &&
    stats.skipDifference >= MIN_DIFF_POINTS - EPSILON
  ) {
    return {
      verdict: ReelFormatVerdict.PROMOTE,
      reason: 'statistically_better',
      stats,
    };
  }
  return { verdict: ReelFormatVerdict.KEEP, reason: 'not_significant', stats };
};

export const decideMode = (
  rows: DecisionHistoryRow[],
): ReelFormatDecisionMode => {
  const count = rows.filter(
    (row) =>
      !row.experimentId.startsWith('guard-') && isConclusive(row.verdict),
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
  const decisions = rows.filter(
    (row) => !row.experimentId.startsWith('guard-'),
  );
  const last = decisions.at(-1);
  if (
    last &&
    last.verdict === ReelFormatVerdict.PROMOTE &&
    last.mode === ReelFormatDecisionMode.AUTO &&
    !last.reverseChallenge &&
    isFormatKnob(last.knob) &&
    policy.champion[last.knob] === last.challengerValue &&
    autoDecided({
      rows: decisions,
      knob: last.knob,
      valueA: last.championValue,
      valueB: last.challengerValue,
    }) === 1
  ) {
    return {
      candidates: [toCandidate(last.knob, last.championValue)],
      reverseChallenge: true,
      needsHumanReview: false,
    };
  }
  const candidates: FormatCandidate[] = [];
  let needsHumanReview = false;
  for (const knob of Object.keys(FORMAT_KNOBS) as FormatKnob[]) {
    for (const value of FORMAT_KNOBS[knob]) {
      if (value === policy.champion[knob]) {
        continue;
      }
      if (
        autoDecided({
          rows: decisions,
          knob,
          valueA: policy.champion[knob],
          valueB: value,
        }) > 0
      ) {
        continue;
      }
      const pairRows = decisions.filter((row) =>
        samePair({ row, knob, valueA: policy.champion[knob], valueB: value }),
      );
      const recent = pairRows.slice(-2);
      if (
        recent.length === 2 &&
        recent.every((row) => isInconclusive(row.verdict))
      ) {
        needsHumanReview = true;
        continue;
      }
      candidates.push(toCandidate(knob, value));
    }
  }
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
  const promoted = [...rows]
    .reverse()
    .find(
      (row) =>
        row.verdict === ReelFormatVerdict.PROMOTE &&
        row.mode === ReelFormatDecisionMode.AUTO &&
        !row.experimentId.startsWith('guard-'),
    );
  if (
    !promoted ||
    !isFormatKnob(promoted.knob) ||
    policy.champion[promoted.knob] !== promoted.challengerValue ||
    rows.some((row) => row.experimentId === `guard-${promoted.experimentId}`)
  ) {
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
  policy,
  missing,
  rows,
}: {
  policy: FormatPolicy | null;
  missing: boolean;
  rows: DecisionHistoryRow[];
}): FormatPolicy | null => {
  const latest = [...rows]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .at(-1);
  if (
    !latest ||
    (!missing && (!policy || policy.version >= latest.policyVersionAfter))
  ) {
    return null;
  }
  return latest.policyAfter;
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
  const champion = { ...policy.champion };
  if (
    verdict === ReelFormatVerdict.PROMOTE &&
    mode === ReelFormatDecisionMode.AUTO &&
    policy.experiment
  ) {
    champion[policy.experiment.knob] = policy.experiment.challenger;
  }
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
    lost: 0,
    error: 0,
    skip_null: 0,
    watch_null: 0,
    low_views: 0,
    no_record: 0,
    arm_mismatch: 0,
    value_mismatch: 0,
    unrealized: 0,
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
  return day >= start && day < today;
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
    return 'error';
  }
  if (
    snapshot.metrics.skipRate === null ||
    !Number.isFinite(snapshot.metrics.skipRate)
  ) {
    return 'skip_null';
  }
  // 시청 가드도 판정 표본 6편 전부로 본다. 값이 빈 영상을 남기면 1편만으로 가드를 통과할 수 있다.
  if (
    snapshot.metrics.avgWatchMs === null ||
    !Number.isFinite(snapshot.metrics.avgWatchMs)
  ) {
    return 'watch_null';
  }
  if (snapshot.metrics.views === null || snapshot.metrics.views < MIN_VIEWS) {
    return 'low_views';
  }
  const record = post.features?.experiment;
  const experiment = policy.experiment!;
  if (
    !record ||
    record.experimentId !== experiment.id ||
    record.knob !== experiment.knob
  ) {
    return 'no_record';
  }
  const assignment = assignArm(policy, day);
  if (record.arm !== assignment.arm) {
    return 'arm_mismatch';
  }
  if (record.values[experiment.knob] !== assignment.values[experiment.knob]) {
    return 'value_mismatch';
  }
  if (!record.realized) {
    return 'unrealized';
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
const isFormatKnob = (knob: string): knob is FormatKnob =>
  Object.prototype.hasOwnProperty.call(FORMAT_KNOBS, knob);
const samePair = ({
  row,
  knob,
  valueA,
  valueB,
}: {
  row: DecisionHistoryRow;
  knob: FormatKnob;
  valueA: FormatKnobValue;
  valueB: FormatKnobValue;
}): boolean =>
  row.knob === knob &&
  ((row.championValue === valueA && row.challengerValue === valueB) ||
    (row.championValue === valueB && row.challengerValue === valueA));
const autoDecided = ({
  rows,
  knob,
  valueA,
  valueB,
}: {
  rows: DecisionHistoryRow[];
  knob: FormatKnob;
  valueA: FormatKnobValue;
  valueB: FormatKnobValue;
}): number =>
  rows.filter(
    (row) =>
      row.mode === ReelFormatDecisionMode.AUTO &&
      isConclusive(row.verdict) &&
      samePair({ row, knob, valueA, valueB }),
  ).length;
const toCandidate = (
  knob: FormatKnob,
  challenger: FormatKnobValue,
): FormatCandidate => ({
  knob,
  challenger,
  id: `${knob}=${JSON.stringify(challenger)}`,
});
