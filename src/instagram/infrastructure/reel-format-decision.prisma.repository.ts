import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ReelFormatDecision as ReelFormatDecisionRow,
} from '@prisma/client';
import { isMatching, P } from 'ts-pattern';

import { PrismaService } from '../../prisma/prisma.service';
import {
  DecisionStatsRecord,
  ExclusionReason,
  PublishRates,
  ReelFormatDecisionMode,
  ReelFormatVerdict,
} from '../domain/format-decision.policy';
import { FormatPolicy, policyProblem } from '../domain/format-policy';
import {
  ReelFormatAiProposal,
  ReelFormatDecision,
  ReelFormatDecisionInput,
  ReelFormatDecisionRepositoryPort,
} from '../domain/port/reel-format-decision.repository.port';

@Injectable()
export class ReelFormatDecisionPrismaRepository implements ReelFormatDecisionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listAll(): Promise<ReelFormatDecision[]> {
    const rows = await this.prisma.reelFormatDecision.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDecision);
  }

  async insert(row: ReelFormatDecisionInput): Promise<boolean> {
    try {
      await this.prisma.reelFormatDecision.create({
        data: {
          ...row,
          championValue: row.championValue,
          challengerValue: row.challengerValue,
          statsJson: row.statsJson as Prisma.InputJsonValue,
          policyAfter: row.policyAfter as Prisma.InputJsonValue,
          aiProposal:
            row.aiProposal == null
              ? Prisma.DbNull
              : (row.aiProposal as Prisma.InputJsonValue),
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  async markReported(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.prisma.reelFormatDecision.updateMany({
      where: { id: { in: ids }, reportedAt: null },
      data: { reportedAt: new Date() },
    });
  }
}

const FORMAT_POLICY_PATTERN = {
  version: P.number,
  frozen: P.boolean,
  champion: { early_card: P.boolean },
  experiment: P.union(null, {
    id: P.string,
    knob: 'early_card',
    challenger: P.boolean,
    start: P.string,
  }),
};

const PLANNER_PROPOSAL_PATTERN = {
  candidateId: P.optional(P.string),
  hypothesis: P.string,
  interpretation: P.string,
  raw: P.string,
};

const toDecision = (row: ReelFormatDecisionRow): ReelFormatDecision => {
  if (
    !isMatching('early_card', row.knob) ||
    !isMatching(
      P.union(
        ReelFormatVerdict.PROMOTE,
        ReelFormatVerdict.KEEP,
        ReelFormatVerdict.HOLD,
        ReelFormatVerdict.ABORT,
      ),
      row.verdict,
    ) ||
    !isMatching(
      P.union(ReelFormatDecisionMode.PROPOSAL, ReelFormatDecisionMode.AUTO),
      row.mode,
    )
  ) {
    throw new Error(
      `릴스 형식 판정 원장 행의 필수 필드가 올바르지 않습니다: ${row.id}`,
    );
  }
  const policyAfter: FormatPolicy | null =
    isMatching(FORMAT_POLICY_PATTERN, row.policyAfter) &&
    policyProblem(row.policyAfter) === ''
      ? row.policyAfter
      : null;
  const championValue = isMatching(
    P.union(P.boolean, P.string, P.number),
    row.championValue,
  )
    ? row.championValue
    : null;
  const challengerValue = isMatching(
    P.union(P.boolean, P.string, P.number),
    row.challengerValue,
  )
    ? row.challengerValue
    : null;
  const decision: ReelFormatDecision = {
    ...row,
    knob: row.knob,
    championValue,
    challengerValue,
    statsJson: toDecisionStats(row.statsJson),
    verdict: row.verdict,
    mode: row.mode,
    policyAfter,
    aiProposal: toAiProposal(row.aiProposal),
  };
  return decision;
};

const toDecisionStats = (value: Prisma.JsonValue): DecisionStatsRecord => {
  if (!isMatching(P.record(P.string, P.unknown), value)) {
    return {};
  }
  const excluded = toExclusions(value.excluded);
  const publishRates = toPublishRates(value.publishRates);
  const samples = isMatching(
    P.array({
      day: P.string,
      reelKey: P.string,
      snapshotId: P.string,
      ageMinutes: P.number,
      arm: P.union('champion', 'challenger'),
      skipRate: P.number,
      avgWatchMs: P.union(P.number, null),
    }),
    value.samples,
  )
    ? value.samples
    : undefined;
  const stats: DecisionStatsRecord = {
    ...(isMatching(P.number, value.nChampion) && {
      nChampion: value.nChampion,
    }),
    ...(isMatching(P.number, value.nChallenger) && {
      nChallenger: value.nChallenger,
    }),
    ...(isMatching(P.union(P.number, null), value.championMeanSkip) && {
      championMeanSkip: value.championMeanSkip,
    }),
    ...(isMatching(P.union(P.number, null), value.challengerMeanSkip) && {
      challengerMeanSkip: value.challengerMeanSkip,
    }),
    ...(isMatching(P.union(P.number, null), value.championMeanWatchMs) && {
      championMeanWatchMs: value.championMeanWatchMs,
    }),
    ...(isMatching(P.union(P.number, null), value.challengerMeanWatchMs) && {
      challengerMeanWatchMs: value.challengerMeanWatchMs,
    }),
    ...(isMatching(P.union(P.number, null), value.skipDifference) && {
      skipDifference: value.skipDifference,
    }),
    ...(isMatching(P.union(P.number, null), value.pValue) && {
      pValue: value.pValue,
    }),
    ...(isMatching(P.number, value.pending) && { pending: value.pending }),
    ...(excluded && { excluded }),
    ...(publishRates && { publishRates }),
    ...(samples && { samples }),
    ...(isMatching(P.boolean, value.nextReverseChallenge) && {
      nextReverseChallenge: value.nextReverseChallenge,
    }),
    ...(isMatching(P.union(P.number, null), value.proposalDecisionNumber) && {
      proposalDecisionNumber: value.proposalDecisionNumber,
    }),
    ...(isMatching(P.boolean, value.needsHumanReview) && {
      needsHumanReview: value.needsHumanReview,
    }),
    ...(isMatching(P.number, value.baselineSkip) && {
      baselineSkip: value.baselineSkip,
    }),
    ...(isMatching(P.union(P.string, null), value.interruptedExperimentId) && {
      interruptedExperimentId: value.interruptedExperimentId,
    }),
  };
  return stats;
};

const toExclusions = (
  value: unknown,
): Partial<Record<ExclusionReason, number>> | undefined => {
  if (!isMatching(P.record(P.string, P.unknown), value)) {
    return undefined;
  }
  const excluded: Partial<Record<ExclusionReason, number>> = {};
  for (const reason of Object.values(ExclusionReason)) {
    const count = value[reason];
    if (isMatching(P.number, count)) {
      excluded[reason] = count;
    }
  }
  return excluded;
};

const toPublishRates = (value: unknown): Partial<PublishRates> | undefined => {
  if (!isMatching(P.record(P.string, P.unknown), value)) {
    return undefined;
  }
  const rates: Partial<PublishRates> = {
    ...(isMatching(P.number, value.championAssigned) && {
      championAssigned: value.championAssigned,
    }),
    ...(isMatching(P.number, value.challengerAssigned) && {
      challengerAssigned: value.challengerAssigned,
    }),
    ...(isMatching(P.number, value.championPublished) && {
      championPublished: value.championPublished,
    }),
    ...(isMatching(P.number, value.challengerPublished) && {
      challengerPublished: value.challengerPublished,
    }),
    ...(isMatching(P.union(P.number, null), value.championRate) && {
      championRate: value.championRate,
    }),
    ...(isMatching(P.union(P.number, null), value.challengerRate) && {
      challengerRate: value.challengerRate,
    }),
    ...(isMatching(P.union(P.number, null), value.gapPoints) && {
      gapPoints: value.gapPoints,
    }),
  };
  return rates;
};

const toAiProposal = (value: Prisma.JsonValue | null): ReelFormatAiProposal => {
  if (isMatching({ error: P.string }, value)) {
    return { error: value.error };
  }
  if (isMatching(PLANNER_PROPOSAL_PATTERN, value)) {
    const proposal: ReelFormatAiProposal = value;
    return proposal;
  }
  return null;
};
