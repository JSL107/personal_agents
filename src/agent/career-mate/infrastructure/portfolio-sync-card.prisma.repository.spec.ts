import { PrismaService } from '../../../prisma/prisma.service';
import { PortfolioSyncCardPrismaRepository } from './portfolio-sync-card.prisma.repository';

describe('PortfolioSyncCardPrismaRepository', () => {
  const createRepository = () => {
    const portfolioSyncCard = {
      findMany: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
      createMany: jest.fn(),
    };
    const repository = new PortfolioSyncCardPrismaRepository({
      portfolioSyncCard,
    } as unknown as PrismaService);
    return { repository, portfolioSyncCard };
  };

  it('채택 행을 한 번의 createMany 로 ACTIVE 상태로 저장한다', async () => {
    const { repository, portfolioSyncCard } = createRepository();
    await repository.createMany([
      {
        slug: 'alpha-pr-1',
        siteProjectId: 'site-1',
        repo: 'owner/alpha',
        topicIndex: 1,
        memberPrs: [],
        coverOf: null,
      },
      {
        slug: 'beta-pr-2',
        siteProjectId: 'site-2',
        repo: 'owner/beta',
        topicIndex: 1,
        memberPrs: [],
        coverOf: null,
      },
    ]);

    expect(portfolioSyncCard.createMany).toHaveBeenCalledTimes(1);
    expect(portfolioSyncCard.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ slug: 'alpha-pr-1', status: 'ACTIVE' }),
        expect.objectContaining({ slug: 'beta-pr-2', status: 'ACTIVE' }),
      ],
    });
  });

  it('sortOrder 를 보내지 않은 갱신은 마지막 봇 값을 건드리지 않는다', async () => {
    const { repository, portfolioSyncCard } = createRepository();
    await repository.upsertActive({
      slug: 'alpha-pr-1',
      siteProjectId: 'site-1',
      repo: 'owner/alpha',
      topicIndex: 1,
      memberPrs: ['owner/alpha#1'],
      coverOf: 'hash',
    });

    const call = portfolioSyncCard.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('lastSentSortOrder');
    expect(call.create.lastSentSortOrder).toBeNull();
  });

  it('위반 카드만 coverOf 를 비우고 빈 목록이면 DB 를 호출하지 않는다', async () => {
    const { repository, portfolioSyncCard } = createRepository();
    await repository.clearCoverOf([]);
    expect(portfolioSyncCard.updateMany).not.toHaveBeenCalled();

    await repository.clearCoverOf(['alpha-pr-1']);
    expect(portfolioSyncCard.updateMany).toHaveBeenCalledWith({
      where: { slug: { in: ['alpha-pr-1'] } },
      data: { coverOf: null },
    });
  });
});
