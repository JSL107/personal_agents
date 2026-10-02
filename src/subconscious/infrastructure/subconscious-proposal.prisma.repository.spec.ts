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

  it('hasProposedSince 는 만료된 표본 카드를 세지 않는다 — 못 본 표본이 운영 카드를 30일 막지 않게', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const repository = new SubconsciousProposalPrismaRepository({
      subconsciousProposal: { count },
    } as unknown as PrismaService);
    const createdAfter = new Date('2026-09-02T00:00:00Z');

    await repository.hasProposedSince('U1', 'github:pr:o/r#1', createdAfter);

    expect(count).toHaveBeenCalledWith({
      where: {
        ownerUserId: 'U1',
        changeKey: 'github:pr:o/r#1',
        createdAt: { gt: createdAfter },
        NOT: { origin: 'DROP_SAMPLE', status: 'EXPIRED' },
      },
    });
  });
});
