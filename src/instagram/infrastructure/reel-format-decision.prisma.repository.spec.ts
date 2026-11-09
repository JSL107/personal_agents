import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
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
  verdict: 'KEEP',
  mode: 'AUTO',
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
