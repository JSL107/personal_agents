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

describe('JobPostingPrismaRepository.findNotifiable — 기피 기술 제외', () => {
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

  it('기피 기술이 있으면 skillTags 에 하나라도 포함된 공고를 NOT 조건으로 뺀다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findNotifiable(80, 10, ['PHP', 'JSP']);

    expect(calls[0].where).toMatchObject({
      NOT: { skillTags: { hasSome: ['PHP', 'JSP'] } },
    });
  });

  // hasSome([]) 을 그대로 조건에 넣으면 항상 거짓이 되어 NOT 이 항상 참이 될 수
  // 있다 — 의도(필터 없음)와 다르게 동작할 위험이 있어, 빈 목록이면 조건 자체를
  // 아예 안 거는지 직접 확인한다.
  it('기피 기술 목록이 비어 있으면 NOT 조건 자체를 걸지 않는다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findNotifiable(80, 10, []);

    expect(calls[0].where).not.toHaveProperty('NOT');
  });

  it('기피 기술 인자를 생략해도 빈 목록과 같이 동작한다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findNotifiable(80, 10);

    expect(calls[0].where).not.toHaveProperty('NOT');
  });
});

describe('JobPostingPrismaRepository.findDetailTargets — 스킬 없는 소스 데드락 방지', () => {
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

  it('점수 조건과 skillTags 빈 조건을 OR 로 묶는다 — 원티드처럼 목록에 스킬이 없는 소스는 점수가 기준 미만이어도 상세 대상에 들어야 한다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);
    const staleBefore = new Date('2026-08-20T00:00:00.000Z');

    await repository.findDetailTargets(80, 20, staleBefore);

    // matchScore 조건만 있으면 원티드(스킬 없음 → 최대 65점)는 기준 80을 못 넘어
    // 영영 상세를 못 받는다. skillTags 빈 조건을 OR 로 더해야 그 데드락이 풀린다.
    expect(calls[0].where).toEqual({
      closedAt: null,
      lastSeenAt: { gte: expect.any(Date) },
      AND: [
        {
          OR: [{ matchScore: { gte: 80 } }, { skillTags: { isEmpty: true } }],
        },
        {
          OR: [
            { detailFetchedAt: null },
            { detailFetchedAt: { lt: staleBefore } },
          ],
        },
      ],
    });
  });
});

describe('JobPostingPrismaRepository.findDetailTargets — 기피 기술 제외', () => {
  // 알림에서 거르는 기피 기술이 상세수집 예산(JOB_FEED_DETAIL_LIMIT)엔 안 걸리면,
  // 알림에 안 뜰 공고가 상세 호출 순번을 대신 차지해 정작 보여줄 공고의 상세
  // 수집이 밀린다 — findNotifiable 과 같은 계약을 여기도 지켜야 한다.
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

  it('기피 기술이 있으면 skillTags 에 하나라도 포함된 공고를 NOT 조건으로 뺀다 — 기존 AND 구조는 유지된다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);
    const staleBefore = new Date('2026-08-20T00:00:00.000Z');

    await repository.findDetailTargets(80, 20, staleBefore, ['PHP', 'JSP']);

    expect(calls[0].where).toMatchObject({
      AND: [
        {
          OR: [{ matchScore: { gte: 80 } }, { skillTags: { isEmpty: true } }],
        },
        {
          OR: [
            { detailFetchedAt: null },
            { detailFetchedAt: { lt: staleBefore } },
          ],
        },
      ],
      NOT: { skillTags: { hasSome: ['PHP', 'JSP'] } },
    });
  });

  it('기피 기술 목록이 비어 있으면(생략 포함) NOT 조건 자체를 걸지 않는다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);
    const staleBefore = new Date('2026-08-20T00:00:00.000Z');

    await repository.findDetailTargets(80, 20, staleBefore, []);
    await repository.findDetailTargets(80, 20, staleBefore);

    expect(calls[0].where).not.toHaveProperty('NOT');
    expect(calls[1].where).not.toHaveProperty('NOT');
  });
});

describe('JobPostingPrismaRepository.findGapCandidates — 빈 JD 제외', () => {
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

  it('jdText 가 null 이거나 빈 문자열인 행을 NOT 조건으로 함께 배제한다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findGapCandidates(80, 10);

    // jdText: { not: null } 만 쓰면 매퍼가 만드는 빈 문자열('')은 SQL 3값 논리상
    // <> 비교를 통과해 걸러지지 않는다(findScoringTargets 의 { not: profileId } 와
    // 같은 함정). null 과 '' 을 각각 명시한 NOT 배열이어야 둘 다 배제된다.
    expect(calls[0].where).toEqual({
      closedAt: null,
      matchScore: { gte: 80 },
      lastSeenAt: { gte: expect.any(Date) },
      gapAgentRunId: null,
      NOT: [{ jdText: null }, { jdText: '' }],
    });
  });

  it('빈 문자열이 아닌 실제 본문이 있으면 정상 대상이 된다 — 과도하게 걸러지지 않는지 확인', async () => {
    const calls: FindManyArgs[] = [];
    const prisma = {
      jobPosting: {
        findMany: jest.fn(async (args: FindManyArgs) => {
          calls.push(args);
          return [
            {
              id: 1,
              jdText: '백엔드 경력 3년 이상',
            },
          ];
        }),
      },
    };
    const repository = new JobPostingPrismaRepository(prisma as never);

    const result = await repository.findGapCandidates(80, 10);

    expect(result).toHaveLength(1);
    // where 조건 자체는 위 테스트와 동일해야 한다 — limit·threshold 만 바뀐다.
    expect(calls[0].where).toMatchObject({
      NOT: [{ jdText: null }, { jdText: '' }],
    });
  });
});

describe('JobPostingPrismaRepository.findGapCandidates — 기피 기술 제외', () => {
  // 알림에서 거른 기피 기술 공고가 갭 분석(모델 호출)에는 그대로 나가면, "저장은
  // 하되 알림에서만 뺀다"는 목적이 알림 표면 두 곳 중 하나에서만 지켜진다.
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

  it('기피 기술이 있으면 NOT 배열에 skillTags hasSome 조건을 더한다 — jdText NOT 조건과 공존한다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findGapCandidates(80, 10, ['PHP', 'JSP']);

    expect(calls[0].where).toEqual({
      closedAt: null,
      matchScore: { gte: 80 },
      lastSeenAt: { gte: expect.any(Date) },
      gapAgentRunId: null,
      NOT: [
        { jdText: null },
        { jdText: '' },
        { skillTags: { hasSome: ['PHP', 'JSP'] } },
      ],
    });
  });

  it('기피 기술 목록이 비어 있으면(생략 포함) jdText NOT 조건만 남는다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findGapCandidates(80, 10, []);
    await repository.findGapCandidates(80, 10);

    expect(calls[0].where.NOT).toEqual([{ jdText: null }, { jdText: '' }]);
    expect(calls[1].where.NOT).toEqual([{ jdText: null }, { jdText: '' }]);
  });
});

describe('JobPostingPrismaRepository.saveDetail', () => {
  it('상세를 저장하며 채점 표식을 지운다 — 새 스킬 기준으로 다시 채점되게 한다', async () => {
    const updateCalls: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }[] = [];
    const prisma = {
      jobPosting: {
        update: jest.fn(async (args: (typeof updateCalls)[number]) => {
          updateCalls.push(args);
          return undefined;
        }),
      },
    };
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.saveDetail({
      id: 1,
      jdText: '백엔드 경력 3년 이상',
      skillTags: ['Java', 'Spring Boot'],
      rawSkillTags: ['Java', 'Spring Boot'],
    });

    expect(updateCalls[0].where).toEqual({ id: 1 });
    // 표식을 지우지 않으면 findScoringTargets 가 재채점 대상으로 잡지 못해,
    // 상세를 받고도 옛 점수에 영원히 머문다(원티드 65점 고정 사고의 근본 원인).
    expect(updateCalls[0].data).toMatchObject({
      jdText: '백엔드 경력 3년 이상',
      skillTags: ['Java', 'Spring Boot'],
      rawSkillTags: ['Java', 'Spring Boot'],
      scoredProfileId: null,
      scoredAt: null,
    });
    expect(updateCalls[0].data.detailFetchedAt).toBeInstanceOf(Date);
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

describe('JobPostingPrismaRepository.findAllForReprocess', () => {
  // 재파생은 사전 갱신 효과를 과거 행까지 소급 적용하는 것이 목적이다.
  // 다른 조회 넷과 달리 lastSeenAt 신선도 조건을 걸면 안 된다 — 걸면 정작
  // 되살려야 할, 최근에 못 본 옛 행이 대상에서 빠진다.
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

  it('lastSeenAt 신선도 조건 없이 마감되지 않은 행 전체를 대상으로 한다', async () => {
    const { prisma, calls } = createFindManyStub();
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.findAllForReprocess();

    expect(calls[0].where).toEqual({ closedAt: null });
    expect(calls[0].where).not.toHaveProperty('lastSeenAt');
  });
});

describe('JobPostingPrismaRepository.saveSkillTags', () => {
  it('새 skillTags 와 함께 채점 표식을 지운다 — 다음 채점에서 다시 걸리게 한다', async () => {
    const updateCalls: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }[] = [];
    const prisma = {
      jobPosting: {
        update: jest.fn(async (args: (typeof updateCalls)[number]) => {
          updateCalls.push(args);
          return undefined;
        }),
      },
    };
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.saveSkillTags(1, ['Java', 'Spring Boot'], 'newhash');

    expect(updateCalls[0].where).toEqual({ id: 1 });
    // 지문을 함께 갱신하지 않으면 다음 수집이 "요건 변경" 으로 오인해 notifiedAt 을
    // 지우고, 재파생만 했을 뿐인데 이미 본 공고가 통째로 다시 알림된다.
    expect(updateCalls[0].data).toEqual({
      skillTags: ['Java', 'Spring Boot'],
      contentHash: 'newhash',
      scoredProfileId: null,
      scoredAt: null,
    });
  });
});

describe('JobPostingPrismaRepository.upsertMany — 콘텐츠 변경 시 재알림', () => {
  const createUpsertStub = (found: {
    id: number;
    contentHash: string;
    detailFetchedAt?: Date | null;
  }) => {
    const updateCalls: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }[] = [];
    return {
      updateCalls,
      prisma: {
        jobPosting: {
          findUnique: jest.fn(async () => ({
            detailFetchedAt: null,
            ...found,
          })),
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

  it('contentHash 가 달라졌으면 notifiedAt·scoredProfileId·scoredAt 을 모두 null 로 되돌린다', async () => {
    const { prisma, updateCalls } = createUpsertStub({
      id: 1,
      contentHash: 'hash-old',
    });
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.upsertMany([BASE_POSTING]);

    // scoredProfileId 를 지우지 않으면, 바뀐 요건 후 매긴 점수가 우연히 같은
    // profileId 값을 갖는 한 findScoringTargets 가 재채점 대상으로 다시 잡지
    // 못해 변경 전 점수가 그대로 알림 판단에 쓰인다.
    expect(updateCalls[0].data).toMatchObject({
      notifiedAt: null,
      scoredProfileId: null,
      scoredAt: null,
    });
  });

  it('contentHash 가 같으면 notifiedAt·scoredProfileId·scoredAt 키를 전혀 건드리지 않는다', async () => {
    const { prisma, updateCalls } = createUpsertStub({
      id: 1,
      contentHash: BASE_POSTING.contentHash,
    });
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.upsertMany([BASE_POSTING]);

    expect(updateCalls[0].data).not.toHaveProperty('notifiedAt');
    expect(updateCalls[0].data).not.toHaveProperty('scoredProfileId');
    expect(updateCalls[0].data).not.toHaveProperty('scoredAt');
  });
});

describe('JobPostingPrismaRepository.upsertMany — 상세로 받은 스킬 보존', () => {
  const createUpsertStub = (found: {
    id: number;
    contentHash: string;
    detailFetchedAt: Date | null;
  }) => {
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

  it('상세를 이미 받은 행은 목록의 빈 skillTags·rawSkillTags 로 덮어쓰지 않는다', async () => {
    const { prisma, updateCalls } = createUpsertStub({
      id: 1,
      contentHash: BASE_POSTING.contentHash,
      detailFetchedAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const repository = new JobPostingPrismaRepository(prisma as never);

    // 원티드처럼 목록에 스킬이 없는 소스가 다시 수집되는 상황을 흉내낸다.
    // 되돌리면 findDetailTargets 데드락이 재발한다(상세를 다시 받을 방법이 없어진다).
    await repository.upsertMany([
      { ...BASE_POSTING, skillTags: [], rawSkillTags: [] },
    ]);

    expect(updateCalls[0].data).not.toHaveProperty('skillTags');
    expect(updateCalls[0].data).not.toHaveProperty('rawSkillTags');
    // 스킬 말고 목록이 갱신할 필드(회사명 등)는 그대로 갱신돼야 한다.
    expect(updateCalls[0].data).toMatchObject({
      company: BASE_POSTING.company,
      title: BASE_POSTING.title,
    });
  });

  it('아직 상세를 못 받은 행은 목록의 skillTags·rawSkillTags 로 그대로 갱신한다', async () => {
    const { prisma, updateCalls } = createUpsertStub({
      id: 1,
      contentHash: BASE_POSTING.contentHash,
      detailFetchedAt: null,
    });
    const repository = new JobPostingPrismaRepository(prisma as never);

    await repository.upsertMany([BASE_POSTING]);

    expect(updateCalls[0].data).toMatchObject({
      skillTags: BASE_POSTING.skillTags,
      rawSkillTags: BASE_POSTING.rawSkillTags,
    });
  });
});

describe('JobPostingPrismaRepository.findLastCollectedAt', () => {
  it('lastSeenAt 최댓값을 마지막 수집 시각으로 돌려준다', async () => {
    const latest = new Date('2026-08-27T07:00:00Z');
    const prisma = {
      jobPosting: {
        aggregate: jest.fn(async () => ({ _max: { lastSeenAt: latest } })),
      },
    };
    const repository = new JobPostingPrismaRepository(prisma as never);

    const result = await repository.findLastCollectedAt();

    expect(result).toBe(latest);
  });

  it('저장된 공고가 없으면 null 을 돌려준다', async () => {
    const prisma = {
      jobPosting: {
        aggregate: jest.fn(async () => ({ _max: { lastSeenAt: null } })),
      },
    };
    const repository = new JobPostingPrismaRepository(prisma as never);

    const result = await repository.findLastCollectedAt();

    expect(result).toBeNull();
  });
});
