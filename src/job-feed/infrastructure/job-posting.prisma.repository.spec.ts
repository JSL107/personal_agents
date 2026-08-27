import { JobPostingPrismaRepository } from './job-posting.prisma.repository';

type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

const createPrismaStub = (updateManyCount: number) => {
  const calls: UpdateManyArgs[] = [];
  return {
    calls,
    prisma: {
      jobPosting: {
        updateMany: jest.fn(async (args: UpdateManyArgs) => {
          calls.push(args);
          return { count: updateManyCount };
        }),
      },
    },
  };
};

describe('JobPostingPrismaRepository.claimForNotification', () => {
  it('아직 아무도 안 가져갔으면 잠그고 true 를 준다', async () => {
    const { prisma, calls } = createPrismaStub(2);
    const repository = new JobPostingPrismaRepository(prisma as never);
    const now = new Date('2026-08-27T00:00:00.000Z');

    await expect(
      repository.claimForNotification('toss|백엔드개발자', now),
    ).resolves.toBe(true);

    // 조건에 notifiedAt: null 이 들어가야 원자적 선점이 된다.
    expect(calls[0].where).toEqual({
      normalizedKey: 'toss|백엔드개발자',
      notifiedAt: null,
    });
    expect(calls[0].data).toEqual({ notifiedAt: now });
  });

  it('그 사이 다른 실행이 가져갔으면 false 를 준다 — 중복 발송을 막는다', async () => {
    const { prisma } = createPrismaStub(0);
    const repository = new JobPostingPrismaRepository(prisma as never);

    await expect(
      repository.claimForNotification('toss|백엔드개발자', new Date()),
    ).resolves.toBe(false);
  });

  it('normalizedKey 로 잠그므로 같은 공고의 다른 소스 행까지 함께 닫힌다', async () => {
    const { prisma, calls } = createPrismaStub(3);
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.claimForNotification('toss|백엔드개발자', new Date());

    expect(calls[0].where).not.toHaveProperty('source');
    expect(calls[0].where).not.toHaveProperty('id');
  });
});
