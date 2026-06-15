import { PrismaService } from '../../../prisma/prisma.service';
import { CareerProfileData } from '../domain/career-mate.type';
import { CareerProfilePrismaRepository } from './career-profile.prisma.repository';

const SAMPLE: CareerProfileData = {
  summary: 's',
  skills: [],
  accomplishments: [],
  meta: { githubLogin: 'octo', windowStart: '2025-06-15', prCount: 0 },
};

describe('CareerProfilePrismaRepository', () => {
  it('save 는 prisma.careerProfile.create 를 호출하고 id 를 반환한다', async () => {
    const create = jest.fn().mockResolvedValue({ id: 42 });
    const prisma = { careerProfile: { create } } as unknown as PrismaService;
    const repo = new CareerProfilePrismaRepository(prisma);

    const result = await repo.save({
      agentRunId: 1,
      slackUserId: 'U1',
      githubLogin: 'octo',
      windowStart: '2025-06-15',
      prCount: 3,
      summary: 's',
      profileJson: SAMPLE,
    });

    expect(result).toEqual({ id: 42 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.slackUserId).toBe('U1');
  });

  it('findLatestBySlackUser 는 없으면 null', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = { careerProfile: { findFirst } } as unknown as PrismaService;
    const repo = new CareerProfilePrismaRepository(prisma);
    expect(await repo.findLatestBySlackUser('U1')).toBeNull();
  });

  it('findLatestBySlackUser 는 row 를 snapshot 으로 매핑한다', async () => {
    const createdAt = new Date('2026-06-15T00:00:00Z');
    const findFirst = jest.fn().mockResolvedValue({
      id: 9,
      agentRunId: 5,
      profileJson: SAMPLE,
      createdAt,
    });
    const prisma = { careerProfile: { findFirst } } as unknown as PrismaService;
    const repo = new CareerProfilePrismaRepository(prisma);

    const snap = await repo.findLatestBySlackUser('U1');
    expect(snap).toEqual({
      id: 9,
      agentRunId: 5,
      profileJson: SAMPLE,
      createdAt,
    });
  });
});
