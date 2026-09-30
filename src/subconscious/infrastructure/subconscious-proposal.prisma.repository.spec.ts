import { PrismaService } from '../../prisma/prisma.service';
import { SubconsciousProposalPrismaRepository } from './subconscious-proposal.prisma.repository';

describe('SubconsciousProposalPrismaRepository', () => {
  it('expirePendingOlderThan 은 TTL 초과 카드를 EXPIRED 로 닫는다 — 사용자 거절(DISMISSED)과 구분한다', async () => {
    // 전부 DISMISSED 로 쓰던 동안 만료 53건이 거절로 읽혔다(2026-09-30 실측).
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const repository = new SubconsciousProposalPrismaRepository({
      subconsciousProposal: { updateMany },
    } as unknown as PrismaService);
    const createdBefore = new Date('2026-09-29T00:00:00Z');

    await expect(
      repository.expirePendingOlderThan('U1', createdBefore),
    ).resolves.toBe(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        ownerUserId: 'U1',
        status: 'PENDING',
        createdAt: { lt: createdBefore },
      },
      data: { status: 'EXPIRED', resolvedAt: expect.any(Date) },
    });
  });
});
