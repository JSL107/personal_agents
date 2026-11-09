import { match } from 'ts-pattern';

import { getKstDateOf } from '../../common/util/kst-date.util';
import {
  assignArm,
  FORMAT_KNOB_NAMES,
  FORMAT_KNOBS,
  FormatAssignment,
  FormatExperiment,
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
const MINUTE_MS = 60_000;
const PUBLISH_RATE_LAG_DAYS = 4; // 3일 스냅숏 창과 게시 당일을 포함한다.
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
export enum ReelFormatDecisionReason {
  PUBLISH_GAP = 'publish_gap',
  WATCH_MISSING = 'watch_missing',
  WATCH_GUARD = 'watch_guard',
  STATISTICALLY_BETTER = 'statistically_better',
  NOT_SIGNIFICANT = 'not_significant',
  TIMEOUT = 'timeout',
  TIMEOUT_PUBLISH_GAP = 'timeout_publish_gap',
  WORST_GUARD = 'worst_guard',
  NO_EXPERIMENT = 'no_experiment',
  INSUFFICIENT_SAMPLES = 'insufficient_samples',
  EARLIER_PENDING = 'earlier_pending',
}

export interface DecisionOutcome {
  experimentId: string;
  knob: FormatKnob;
  championValue: FormatKnobValue;
  challengerValue: FormatKnobValue;
  verdict: ReelFormatVerdict;
  mode: ReelFormatDecisionMode;
  reverseChallenge: boolean;
}
export interface DecisionHistoryRow extends DecisionOutcome {
  policyVersionAfter: number;
  policyAfter: FormatPolicy;
  statsJson: DecisionStatsRecord;
  decidedAt: Date;
}
export interface PromotionDecision extends DecisionHistoryRow {
  statsJson: JudgmentDecisionStats;
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
export type JudgmentDecisionStats = DecisionStats & {
  kind: 'judgment';
  nextReverseChallenge: boolean;
  proposalDecisionNumber: number | null;
  needsHumanReview: boolean;
};
export interface GuardDecisionStats {
  kind: 'guard';
  meanSkip: number;
  baselineSkip: number;
  samples: ScoredSample[];
  interruptedExperimentId: string | null;
  nextReverseChallenge: boolean;
  needsHumanReview: boolean;
}
export type DecisionStatsRecord = JudgmentDecisionStats | GuardDecisionStats;
export interface JudgeResult {
  verdict: ReelFormatVerdict | null;
  reason: ReelFormatDecisionReason;
  stats: DecisionStats;
}
interface VerdictDecision {
  verdict: ReelFormatVerdict;
  reason: ReelFormatDecisionReason;
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
  promoted: PromotionDecision;
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
  // 12편 중 도전자 6편을 고르는 924가지 배정을 12비트 마스크 숫자로 센다(조합마다 배열을 만들지 않는다).
  const allocations = Array.from(
    { length: 1 << values.length },
    (_, mask) => mask,
  ).filter((mask) => bitCount(mask) === MIN_SAMPLES);
  const extreme = allocations.filter((mask) => {
    const challengerTotal = values.reduce(
      (sum, value, index) => ((mask >> index) & 1 ? sum + value : sum),
      0,
    );
    const championMean = (total - challengerTotal) / MIN_SAMPLES;
    const challengerMean = challengerTotal / MIN_SAMPLES;
    return championMean - challengerMean >= observed - EPSILON;
  }).length;
  return extreme / allocations.length;
};

const bitCount = (mask: number): number =>
  mask.toString(2).replaceAll('0', '').length;

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
  const eligible = posts.filter(
    (post): post is PublishedDailyPost =>
      isPublishedDailyPost(post) &&
      reelDayOf(post) >= experiment.start &&
      reelDayOf(post) < today,
  );
  for (const post of eligible.sort((left, right) =>
    left.reelKey.localeCompare(right.reelKey),
  )) {
    const day = reelDayOf(post);
    const snapshot = byPost.get(post.id);
    if (!snapshot) {
      const ageMinutes =
        (now.getTime() - post.publishedAt.getTime()) / MINUTE_MS;
      if (ageMinutes <= INSIGHT_LOOKBACK_MINUTES) {
        collection.pendingDays.push(day);
      } else {
        collection.excluded[ExclusionReason.LOST] += 1;
      }
      continue;
    }
    const score = scoreSnapshot({ snapshot, requireWatch: true });
    if (typeof score !== 'object') {
      collection.excluded[score] += 1;
      continue;
    }
    const assignment = assignArm({ policy: policy, day: day });
    const reason = exclusionReason({
      post,
      experiment,
      assignment,
    });
    if (reason) {
      collection.excluded[reason] += 1;
      continue;
    }
    const arm = assignment.arm;
    collection[arm].push({
      day,
      reelKey: post.reelKey,
      snapshotId: snapshot.id,
      ageMinutes: snapshot.ageMinutes,
      arm,
      skipRate: score.skipRate,
      avgWatchMs: score.avgWatchMs,
    });
  }
  collection.publishRates = countPublishRates({
    policy,
    experiment,
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
    return {
      verdict: null,
      reason: ReelFormatDecisionReason.NO_EXPERIMENT,
      stats,
    };
  }
  if (!complete) {
    if (
      dayDifference({ from: policy.experiment.start, to: today }) > ABORT_DAYS
    ) {
      const reason = publishGapExceeded(samples.publishRates)
        ? ReelFormatDecisionReason.TIMEOUT_PUBLISH_GAP
        : ReelFormatDecisionReason.TIMEOUT;
      return {
        verdict: ReelFormatVerdict.ABORT,
        reason,
        stats,
      };
    }
    return {
      verdict: null,
      reason: ReelFormatDecisionReason.INSUFFICIENT_SAMPLES,
      stats,
    };
  }
  const lastChampionDay = champion[MIN_SAMPLES - 1].day;
  const lastChallengerDay = challenger[MIN_SAMPLES - 1].day;
  const lastDay =
    lastChampionDay > lastChallengerDay ? lastChampionDay : lastChallengerDay;
  if (samples.pendingDays.some((day) => day < lastDay)) {
    return {
      verdict: null,
      reason: ReelFormatDecisionReason.EARLIER_PENDING,
      stats,
    };
  }
  const publishGap = publishGapExceeded(samples.publishRates);
  if (!publishGap) {
    if (championMeanSkip !== null && challengerMeanSkip !== null) {
      stats.skipDifference = championMeanSkip - challengerMeanSkip;
    }
    stats.pValue = permutationPValue({
      champion: champion.map((sample) => sample.skipRate),
      challenger: challenger.map((sample) => sample.skipRate),
    });
  }
  const watchMissing =
    stats.championMeanWatchMs === null || stats.challengerMeanWatchMs === null;
  const watchGuardPassed =
    stats.championMeanWatchMs !== null &&
    stats.challengerMeanWatchMs !== null &&
    stats.challengerMeanWatchMs >=
      stats.championMeanWatchMs - WATCH_GUARD_MS - EPSILON;
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
      reason: ReelFormatDecisionReason.PUBLISH_GAP,
    }))
    .with({ watchMissing: true }, () => ({
      verdict: ReelFormatVerdict.KEEP,
      reason: ReelFormatDecisionReason.WATCH_MISSING,
    }))
    .with({ watchGuardPassed: false }, () => ({
      verdict: ReelFormatVerdict.KEEP,
      reason: ReelFormatDecisionReason.WATCH_GUARD,
    }))
    .with({ significant: true }, () => ({
      verdict: ReelFormatVerdict.PROMOTE,
      reason: ReelFormatDecisionReason.STATISTICALLY_BETTER,
    }))
    .otherwise(() => ({
      verdict: ReelFormatVerdict.KEEP,
      reason: ReelFormatDecisionReason.NOT_SIGNIFICANT,
    }));
  return { ...decision, stats };
};

export const countConclusiveDecisions = (rows: DecisionOutcome[]): number =>
  rows.filter((row) => !isGuardRow(row) && isConclusive(row.verdict)).length;

export const decideMode = (rows: DecisionOutcome[]): ReelFormatDecisionMode => {
  if (countConclusiveDecisions(rows) < PROPOSAL_DECISIONS) {
    return ReelFormatDecisionMode.PROPOSAL;
  }
  return ReelFormatDecisionMode.AUTO;
};

export const listCandidates = ({
  policy,
  rows,
}: {
  policy: FormatPolicy;
  rows: DecisionOutcome[];
}): CandidateList => {
  const decisions = rows.filter((row) => !isGuardRow(row));
  const last = decisions.at(-1);
  if (last && isReverseChallengeDue({ last, policy, decisions })) {
    return {
      candidates: [
        toCandidate({ knob: last.knob, challenger: last.championValue }),
      ],
      reverseChallenge: true,
      needsHumanReview: false,
    };
  }
  const pairs = FORMAT_KNOB_NAMES.flatMap((knob) =>
    FORMAT_KNOBS[knob].map((value) => ({
      knob,
      value,
      key: pairKey({
        knob,
        firstValue: policy.champion[knob],
        secondValue: value,
      }),
    })),
  );
  const available = pairs.filter(({ knob, value, key }) => {
    if (value === policy.champion[knob]) {
      return false;
    }
    return !decisions.some(
      (row) =>
        row.mode === ReelFormatDecisionMode.AUTO &&
        isConclusive(row.verdict) &&
        pairKeyOf(row) === key,
    );
  });
  const blocked = available.filter(({ key }) => {
    const pairRows = decisions.filter((row) => pairKeyOf(row) === key);
    const recent = pairRows.slice(-2);
    const twiceInconclusive =
      recent.length === 2 && recent.every((row) => isInconclusive(row.verdict));
    return twiceInconclusive;
  });
  const blockedKeys = new Set(blocked.map(({ key }) => key));
  const candidates = available
    .filter(({ key }) => !blockedKeys.has(key))
    .map(({ knob, value }) => toCandidate({ knob, challenger: value }));
  const needsHumanReview = blocked.length > 0;
  return { candidates, reverseChallenge: false, needsHumanReview };
};

export const checkWorstGuard = ({
  promotion,
  posts,
  snapshots,
  today,
  now,
}: {
  promotion: PromotionDecision;
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
  today: string;
  now: Date;
}): WorstGuardResult | null => {
  const baselineSkip = promotion.statsJson.championMeanSkip;
  if (baselineSkip === null || !Number.isFinite(baselineSkip)) {
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
  const firstEligibleDay = getKstDateOf(promotion.decidedAt);
  for (const post of posts
    .filter(
      (item): item is PublishedDailyPost =>
        isPublishedDailyPost(item) &&
        reelDayOf(item) >= firstEligibleDay &&
        reelDayOf(item) < today,
    )
    .sort((a, b) => a.reelKey.localeCompare(b.reelKey))) {
    const record = post.features?.experiment;
    if (
      !record ||
      record.policyVersion < promotion.policyVersionAfter ||
      record.values[promotion.knob] !== promotion.challengerValue ||
      !record.realized
    ) {
      continue;
    }
    const snapshot = byPost.get(post.id);
    if (!snapshot) {
      if (
        (now.getTime() - post.publishedAt.getTime()) / MINUTE_MS <=
        INSIGHT_LOOKBACK_MINUTES
      ) {
        pending.push(reelDayOf(post));
      }
      continue;
    }
    const score = scoreSnapshot({ snapshot, requireWatch: false });
    if (typeof score !== 'object') {
      continue;
    }
    selected.push({
      day: reelDayOf(post),
      reelKey: post.reelKey,
      snapshotId: snapshot.id,
      ageMinutes: snapshot.ageMinutes,
      arm: record.arm,
      skipRate: score.skipRate,
      avgWatchMs: score.avgWatchMs,
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
    promoted: promotion,
    samples,
    meanSkip,
    baselineSkip,
    shouldRevert: meanSkip > baselineSkip + WORST_GUARD_POINTS,
  };
};

export const planRecovery = ({
  state,
  latest,
}: {
  state: FormatPolicyRead;
  latest: DecisionHistoryRow | null;
}): FormatPolicy | null => {
  if (!latest) {
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
  const start = addDays({ day: today, days: 1 });
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
type PublishedDailyPost = InstagramPost & { publishedAt: Date };
const reelDayOf = (post: { reelKey: string }): string =>
  post.reelKey.slice(0, 10);
const isPublishedDailyPost = (
  post: InstagramPost,
): post is PublishedDailyPost => {
  if (
    !DAILY_KEY.test(post.reelKey) ||
    post.status !== InstagramPostStatus.PUBLISHED ||
    !post.publishedAt
  ) {
    return false;
  }
  return true;
};
interface SnapshotScore {
  skipRate: number;
  avgWatchMs: number | null;
}
const scoreSnapshot = ({
  snapshot,
  requireWatch,
}: {
  snapshot: InsightSnapshot;
  requireWatch: boolean;
}): SnapshotScore | ExclusionReason => {
  if (snapshot.error) {
    return ExclusionReason.ERROR;
  }
  const { skipRate, avgWatchMs, views } = snapshot.metrics;
  if (skipRate === null || !Number.isFinite(skipRate)) {
    return ExclusionReason.SKIP_NULL;
  }
  if (requireWatch && (avgWatchMs === null || !Number.isFinite(avgWatchMs))) {
    return ExclusionReason.WATCH_NULL;
  }
  if (views === null || views < MIN_VIEWS) {
    return ExclusionReason.LOW_VIEWS;
  }
  const safeWatch =
    avgWatchMs !== null && Number.isFinite(avgWatchMs) ? avgWatchMs : null;
  return { skipRate, avgWatchMs: safeWatch };
};
const exclusionReason = ({
  post,
  experiment,
  assignment,
}: {
  post: PublishedDailyPost;
  experiment: FormatExperiment;
  assignment: FormatAssignment;
}): ExclusionReason | null => {
  const record = post.features?.experiment;
  if (
    !record ||
    record.experimentId !== experiment.id ||
    record.knob !== experiment.knob
  ) {
    return ExclusionReason.NO_RECORD;
  }
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
  experiment,
  posts,
  today,
}: {
  policy: FormatPolicy;
  experiment: FormatExperiment;
  posts: PublishedDailyPost[];
  today: string;
}): PublishRates => {
  const published = new Set(posts.map(reelDayOf));
  const lastAssignableDay = addDays({
    day: today,
    days: -PUBLISH_RATE_LAG_DAYS,
  });
  const assignableDays = Array.from(
    {
      length: Math.max(
        0,
        dayDifference({ from: experiment.start, to: lastAssignableDay }) + 1,
      ),
    },
    (_, offset) => addDays({ day: experiment.start, days: offset }),
  );
  const arms = assignableDays.map((day) => ({
    arm: assignArm({ policy: policy, day: day }).arm,
    isPublished: published.has(day),
  }));
  const championDays = arms.filter(({ arm }) => arm === 'champion');
  const challengerDays = arms.filter(({ arm }) => arm === 'challenger');
  const championPublished = championDays.filter(
    ({ isPublished }) => isPublished,
  ).length;
  const challengerPublished = challengerDays.filter(
    ({ isPublished }) => isPublished,
  ).length;
  const counts = {
    championAssigned: championDays.length,
    challengerAssigned: challengerDays.length,
    championPublished,
    challengerPublished,
  };
  if (championDays.length === 0 || challengerDays.length === 0) {
    return {
      ...counts,
      championRate: null,
      challengerRate: null,
      gapPoints: null,
    };
  }
  const championRate = (100 * championPublished) / championDays.length;
  const challengerRate = (100 * challengerPublished) / challengerDays.length;
  return {
    ...counts,
    championRate,
    challengerRate,
    gapPoints: Math.abs(championRate - challengerRate),
  };
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
const dayDifference = ({ from, to }: { from: string; to: string }): number => {
  const difference =
    Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return difference / DAY_MS;
};
const addDays = ({ day, days }: { day: string; days: number }): string => {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
  const iso = next.toISOString();
  return iso.slice(0, 10);
};
export const isConclusive = (verdict: ReelFormatVerdict): boolean => {
  const conclusive =
    verdict === ReelFormatVerdict.PROMOTE || verdict === ReelFormatVerdict.KEEP;
  return conclusive;
};
const isInconclusive = (verdict: ReelFormatVerdict): boolean => {
  const inconclusive =
    verdict === ReelFormatVerdict.HOLD || verdict === ReelFormatVerdict.ABORT;
  return inconclusive;
};
export const isGuardRow = (row: DecisionOutcome): boolean =>
  row.experimentId.startsWith('guard-');
export const isAutoPromotion = (
  row: DecisionHistoryRow,
): row is PromotionDecision => {
  const autoPromotion =
    row.statsJson.kind === 'judgment' &&
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
  last: DecisionOutcome;
  policy: FormatPolicy;
  decisions: DecisionOutcome[];
}): boolean => {
  const undecidedReverse =
    last.verdict === ReelFormatVerdict.PROMOTE &&
    last.mode === ReelFormatDecisionMode.AUTO &&
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
export const findActivePromotion = ({
  policy,
  rows,
}: {
  policy: FormatPolicy;
  rows: DecisionHistoryRow[];
}): PromotionDecision | null => {
  const promotedIndex = rows.map(isAutoPromotion).lastIndexOf(true);
  const promoted = rows[promotedIndex];
  if (!promoted || !isAutoPromotion(promoted)) {
    return null;
  }
  if (policy.champion[promoted.knob] !== promoted.challengerValue) {
    return null;
  }
  const settled = rows
    .slice(promotedIndex + 1)
    .some((row) => isGuardRow(row) || row.statsJson.kind === 'judgment');
  if (settled) {
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
  return JSON.stringify([knob, values]);
};
const pairKeyOf = (row: DecisionOutcome): string =>
  pairKey({
    knob: row.knob,
    firstValue: row.championValue,
    secondValue: row.challengerValue,
  });
const autoDecided = ({
  rows,
  knob,
  firstValue,
  secondValue,
}: {
  rows: DecisionOutcome[];
} & PairValues): number => {
  const key = pairKey({ knob, firstValue, secondValue });
  return rows.filter(
    (row) =>
      row.mode === ReelFormatDecisionMode.AUTO &&
      isConclusive(row.verdict) &&
      pairKeyOf(row) === key,
  ).length;
};
const toCandidate = ({
  knob,
  challenger,
}: {
  knob: FormatKnob;
  challenger: FormatKnobValue;
}): FormatCandidate => ({
  knob,
  challenger,
  id: `${knob}=${JSON.stringify(challenger)}`,
});
