import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import {
  ReelFormatDecisionMode,
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
  statsJson: {},
  verdict: ReelFormatVerdict.KEEP,
  mode: ReelFormatDecisionMode.AUTO,
  reverseChallenge: false,
  reason: 'test',
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
  it('손상된 선택 JSON 필드만 버리고 유효한 원장 행은 유지한다', async () => {
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

    const rows = await repository.listAll();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: 'row-1',
        championValue: null,
        challengerValue: null,
        statsJson: {
          championMeanSkip: 60,
          excluded: { low_views: 2 },
          publishRates: { championRate: 90 },
          needsHumanReview: true,
        },
        policyAfter: null,
        aiProposal: null,
      }),
    );
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
      },
    ]);
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { findMany },
    } as unknown as PrismaService);

    const rows = await repository.listAll();

    expect(rows[0].policyAfter).toEqual(row.policyAfter);
    expect(rows[0].aiProposal).toEqual(proposal);
  });

  it('고유 제약 충돌은 false를 반환한다', async () => {
    const create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    const repository = new ReelFormatDecisionPrismaRepository({
      reelFormatDecision: { create },
    } as unknown as PrismaService);
    expect(await repository.insert(row)).toBe(false);
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
