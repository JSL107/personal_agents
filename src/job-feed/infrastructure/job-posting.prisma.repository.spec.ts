import { NormalizedJobPosting } from '../domain/job-feed.type';
import { JobPostingPrismaRepository } from './job-posting.prisma.repository';

type UpdateManyArgs = {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
};

type FindManyArgs = {
  where: Record<string, unknown>;
};

const BASE_POSTING: NormalizedJobPosting = {
  source: 'jumpit',
  sourceId: '123',
  company: '토스',
  companyKey: 'toss',
  title: '백엔드 개발자',
  detailUrl: 'https://example.com/jobs/123',
  skillTags: ['nestjs'],
  rawSkillTags: ['NestJS'],
  minYears: 1,
  maxYears: 3,
  yearsSource: 'RANGE',
  rawJobLevel: null,
  experienceLevel: 'junior',
  locations: ['서울'],
  rawLocations: ['서울 강남구'],
  normalizedKey: 'toss|백엔드개발자',
  contentHash: 'hash-v1',
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

describe('JobPostingPrismaRepository.findScoringTargets', () => {
  const createFindManyStub = () => {
    const calls: FindManyArgs[] = [];
    return {
      calls,
      prisma: {
        jobPosting: {
          findMany: jest.fn(async (args: FindManyArgs) => {
            calls.push(args);
            return [];
          }),
        },
      },
    };
  };

  it('profileId 가 있으면 matchScore null · scoredProfileId null · 다른 프로필 세 조건을 모두 건다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findScoringTargets(7);

    // scoredProfileId 는 CareerProfile 삭제 시 onDelete: SetNull 로 null 이 될 수 있다.
    // { not: 7 } 만 걸면 SQL 3값 논리상 NULL 행이 <> 비교에서 빠져 영영 재채점 안 된다 —
    // { scoredProfileId: null } 조건을 별도로 더해야 그 행도 잡힌다.
    expect(calls[0].where).toEqual({
      closedAt: null,
      lastSeenAt: { gte: expect.any(Date) },
      OR: [
        { matchScore: null },
        { scoredProfileId: null },
        { scoredProfileId: { not: 7 } },
      ],
    });
  });

  it('profileId 가 null 이면 scoredProfileId null 조건을 중복으로 넣지 않는다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findScoringTargets(null);

    // profileId 자체가 null 인 경우 { scoredProfileId: null } 을 또 넣으면
    // "프로필 없이 정상 채점된" 행까지 매번 재채점 대상으로 다시 걸린다.
    expect(calls[0].where).toEqual({
      closedAt: null,
      lastSeenAt: { gte: expect.any(Date) },
      OR: [{ matchScore: null }, { scoredProfileId: { not: null } }],
    });
  });
});

describe('JobPostingPrismaRepository — 신선도 조건 (lastSeenAt)', () => {
  // 이번 수집에서 못 본 공고는 마감됐거나 직군 필터에서 걸러진 것이다.
  // 조건이 없으면 옛 행이 DB 에 영원히 남아 계속 채점·알림·상세수집·갭분석 대상이 된다.
  const createFindManyStub = () => {
    const calls: FindManyArgs[] = [];
    return {
      calls,
      prisma: {
        jobPosting: {
          findMany: jest.fn(async (args: FindManyArgs) => {
            calls.push(args);
            return [];
          }),
        },
      },
    };
  };

  it.each([
    {
      name: 'findScoringTargets',
      call: (repository: JobPostingPrismaRepository) => {
        return repository.findScoringTargets(null);
      },
    },
    {
      name: 'findNotifiable',
      call: (repository: JobPostingPrismaRepository) => {
        return repository.findNotifiable(60, 10);
      },
    },
    {
      name: 'findDetailTargets',
      call: (repository: JobPostingPrismaRepository) => {
        return repository.findDetailTargets(60, 10, new Date());
      },
    },
    {
      name: 'findGapCandidates',
      call: (repository: JobPostingPrismaRepository) => {
        return repository.findGapCandidates(60, 10);
      },
    },
  ])('$name 은 최근 이틀 안에 본 공고만 대상으로 삼는다', async ({ call }) => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await call(repository);

    const lastSeenAt = calls[0].where.lastSeenAt as { gte: Date };
    expect(lastSeenAt.gte).toBeInstanceOf(Date);
    // FRESHNESS_WINDOW_MS = 2일. 실행 지연을 감안해 5초 오차를 허용한다.
    const expectedCutoffMs = Date.now() - 2 * 24 * 60 * 60 * 1000;
    expect(lastSeenAt.gte.getTime()).toBeGreaterThan(expectedCutoffMs - 5000);
    expect(lastSeenAt.gte.getTime()).toBeLessThan(expectedCutoffMs + 5000);
  });
});

describe('JobPostingPrismaRepository.upsertMany — 콘텐츠 변경 시 재알림', () => {
  const createUpsertStub = (found: { id: number; contentHash: string }) => {
    const updateCalls: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }[] = [];
    return {
      updateCalls,
      prisma: {
        jobPosting: {
          findUnique: jest.fn(async () => found),
          create: jest.fn(async () => undefined),
          update: jest.fn(
            async (args: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }) => {
              updateCalls.push(args);
              return undefined;
            },
          ),
        },
      },
    };
  };

  it('contentHash 가 달라졌으면 notifiedAt: null 을 update data 에 싣는다', async () => {
    const { prisma, updateCalls } = createUpsertStub({
      id: 1,
      contentHash: 'hash-old',
    });
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.upsertMany([BASE_POSTING]);

    expect(updateCalls[0].data).toMatchObject({ notifiedAt: null });
  });

  it('contentHash 가 같으면 notifiedAt 키 자체를 넣지 않는다 — 이미 본 공고가 다시 뜨면 안 된다', async () => {
    const { prisma, updateCalls } = createUpsertStub({
      id: 1,
      contentHash: BASE_POSTING.contentHash,
    });
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.upsertMany([BASE_POSTING]);

    expect(updateCalls[0].data).not.toHaveProperty('notifiedAt');
  });
});
