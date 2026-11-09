import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReelFormatDecisionMode,
  ReelFormatDecisionReason,
  ReelFormatVerdict,
} from '../domain/format-decision.policy';
import { ReelFormatDecisionInput } from '../domain/port/reel-format-decision.repository.port';
import { ReelFormatDecisionPrismaRepository } from './reel-format-decision.prisma.repository';

const row: ReelFormatDecisionInput = {
  experimentId: 'early_card-2026-11-10',
  knob: 'early_card',
  championValue: false,
  challengerValue: true,
  nChampion: 6,
  nChallenger: 6,
  excluded: 0,
  statsJson: {
    kind: 'judgment',
    nChampion: 6,
    nChallenger: 6,
    championMeanSkip: 60,
    challengerMeanSkip: 61,
    championMeanWatchMs: 1000,
    challengerMeanWatchMs: 1000,
    skipDifference: -1,
    pValue: 1,
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
    pending: 0,
    publishRates: {
      championAssigned: 6,
      challengerAssigned: 6,
      championPublished: 6,
      challengerPublished: 6,
      championRate: 100,
      challengerRate: 100,
      gapPoints: 0,
    },
    samples: [],
    nextReverseChallenge: false,
    proposalDecisionNumber: null,
    needsHumanReview: false,
  },
  verdict: ReelFormatVerdict.KEEP,
  mode: ReelFormatDecisionMode.AUTO,
  reverseChallenge: false,
  reason: ReelFormatDecisionReason.NOT_SIGNIFICANT,
  policyVersionBefore: 1,
  policyVersionAfter: 2,
  policyAfter: {
    version: 2,
    frozen: false,
    champion: { early_card: false },
    experiment: null,
  },
  aiProposal: null,
  decidedAt: new Date('2026-11-09T00:00:00Z'),
};

describe('ReelFormatDecisionPrismaRepository', () => {
  it('손상된 JSON 행이 있으면 원장 전체 읽기를 중단하고 ID를 보고한다', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        ...row,
        id: 'row-1',
        reportedAt: null,
        createdAt: new Date('2026-11-09T00:00:00Z'),
        championValue: { invalid: true },
        challengerValue: ['invalid'],
        statsJson: {
          championMeanSkip: 60,
          challengerMeanSkip: 'invalid',
          excluded: { low_views: 2, lost: 'invalid' },
          publishRates: { championRate: 90, challengerRate: 'invalid' },
          needsHumanReview: true,
        },
        policyAfter: { version: 'invalid' },
        aiProposal: { interpretation: 42 },
      },
    ]);
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { findMany },
    } as unknown as PrismaService);

    await expect(repository.listAll()).rejects.toMatchObject({
      ids: ['row-1'],
    });
  });

  it('유효한 정책과 AI 제안은 읽을 때 보존한다', async () => {
    const proposal = {
      hypothesis: '개선 가설',
      interpretation: '개선 해석',
      raw: '{}',
    };
    const findMany = jest.fn().mockResolvedValue([
      {
        ...row,
        id: 'row-2',
        reportedAt: null,
        createdAt: new Date('2026-11-09T00:00:00Z'),
        aiProposal: proposal,
        statsJson: row.statsJson,
      },
    ]);
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { findMany },
    } as unknown as PrismaService);

    const rows = await repository.listAll();

    expect(rows[0].policyAfter).toEqual(row.policyAfter);
    expect(rows[0].aiProposal).toEqual(proposal);
  });

  it('삽입 결과로 생성된 원장 행을 반환한다', async () => {
    const created = {
      ...row,
      id: 'created-row',
      reportedAt: null,
      createdAt: row.decidedAt,
    };
    const create = jest.fn().mockResolvedValue(created);
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { create },
    } as unknown as PrismaService);

    expect(await repository.insert(row)).toEqual(created);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('고유 제약 충돌은 null을 반환한다', async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { create },
    } as unknown as PrismaService);
    expect(await repository.insert(row)).toBeNull();
  });
  it('전달된 행만 보고 완료로 표시한다', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { updateMany },
    } as unknown as PrismaService);
    await repository.markReported(['id']);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['id'] }, reportedAt: null },
      }),
    );
  });
});
