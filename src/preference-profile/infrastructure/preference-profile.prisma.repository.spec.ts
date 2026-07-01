import { EMPTY_PROFILE } from '../domain/preference-profile.type';
import { PreferenceProfilePrismaRepository } from './preference-profile.prisma.repository';

describe('PreferenceProfilePrismaRepository', () => {
  const buildPrisma = () => ({
    userPreferenceProfile: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(async (fns: unknown) => {
      // 배열 형태 트랜잭션 호출을 순차 실행 흉내
      if (Array.isArray(fns)) {
        return Promise.all(fns);
      }
      return fns;
    }),
  });

  it('findActive 는 supersededAt null row 를 파싱해 반환', async () => {
    const prisma = buildPrisma();
    prisma.userPreferenceProfile.findFirst.mockResolvedValue({
      version: 3,
      profileJson: { tone: ['간결'] },
    });
    const repo = new PreferenceProfilePrismaRepository(prisma as never);
    const active = await repo.findActive('U1');
    expect(active?.version).toBe(3);
    expect(active?.profile.tone).toEqual(['간결']);
  });

  it('findActive 는 row 없으면 null', async () => {
    const prisma = buildPrisma();
    prisma.userPreferenceProfile.findFirst.mockResolvedValue(null);
    const repo = new PreferenceProfilePrismaRepository(prisma as never);
    expect(await repo.findActive('U1')).toBeNull();
  });

  it('saveNewVersion 은 이전 active supersede + 새 version create', async () => {
    const prisma = buildPrisma();
    const repo = new PreferenceProfilePrismaRepository(prisma as never);
    await repo.saveNewVersion('U1', 4, EMPTY_PROFILE);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.userPreferenceProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerUserId: 'U1', supersededAt: null },
      }),
    );
    expect(prisma.userPreferenceProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerUserId: 'U1', version: 4 }),
      }),
    );
  });
});

describe('PreferenceProposalPrismaRepository', () => {
  const buildPrisma = () => ({
    preferenceProposal: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  });

  it('countPendingSince 는 PENDING status 와 createdAt gte 필터로 count 반환', async () => {
    const { PreferenceProposalPrismaRepository } =
      await import('./preference-proposal.prisma.repository');
    const prisma = buildPrisma();
    prisma.preferenceProposal.count.mockResolvedValue(5);
    const repo = new PreferenceProposalPrismaRepository(prisma as never);
    const sinceMs = Date.now() - 1000 * 60 * 60;
    const result = await repo.countPendingSince('U1', sinceMs);
    expect(result).toBe(5);
    expect(prisma.preferenceProposal.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerUserId: 'U1',
          status: 'PENDING',
          createdAt: expect.objectContaining({
            gte: new Date(sinceMs),
          }),
        }),
      }),
    );
  });
});
