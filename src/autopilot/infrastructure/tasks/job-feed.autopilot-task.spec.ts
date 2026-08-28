import { JobFeedAutopilotTask } from './job-feed.autopilot-task';

// app.config.ts 가 JOB_FEED_MATCH_THRESHOLD 등을 @Type(() => Number) 로 선언한 뒤로
// ConfigService.get() 은 실제로 number 타입을 돌려준다(문자열이 아니다) — mock 도
// 실제 계약과 같은 타입으로 맞춘다.
function makeConfig(values: Record<string, string | number | undefined> = {}) {
  return { get: jest.fn((key: string) => values[key]) };
}

const CONTEXT = { ownerSlackUserId: 'U1', firedAtKst: '2026-08-27' };

const CAREER_PROFILE_WITH_TAGS = {
  id: 7,
  profileJson: {
    accomplishments: [
      { techTags: ['Java', 'Spring Boot'] },
      { techTags: ['Java'] },
    ],
  },
};

const makeDeps = (
  overrides: {
    collectResult?: unknown;
    profile?: unknown;
    scoreResult?: unknown;
    fetchDetailResult?: unknown;
    notifiablePostings?: unknown[];
    lastCollectedAt?: Date | null;
  } = {},
) => {
  const collect = {
    execute: jest.fn().mockResolvedValue(
      overrides.collectResult ?? {
        outcomes: [],
        upsert: { created: 0, updated: 0, contentChanged: 0 },
        unmatchedSkillTags: [],
      },
    ),
  };
  const score = {
    execute: jest.fn().mockResolvedValue(
      overrides.scoreResult ?? {
        scored: 0,
        skipped: false,
        reason: null,
        histogram: {},
        profileTokenCount: 0,
      },
    ),
  };
  const fetchDetail = {
    execute: jest.fn().mockResolvedValue(
      overrides.fetchDetailResult ?? {
        attempted: 0,
        updated: 0,
        failed: 0,
        skippedNoDetailSupport: 0,
      },
    ),
  };
  const listNotifiable = {
    execute: jest.fn().mockResolvedValue(overrides.notifiablePostings ?? []),
  };
  const prisma = {
    careerProfile: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'profile' in overrides ? overrides.profile : CAREER_PROFILE_WITH_TAGS,
        ),
    },
  };
  const jobPostingRepository = {
    findLastCollectedAt: jest
      .fn()
      .mockResolvedValue(overrides.lastCollectedAt ?? new Date()),
  };
  return {
    collect,
    score,
    fetchDetail,
    listNotifiable,
    prisma,
    jobPostingRepository,
  };
};

const buildTask = (
  deps: ReturnType<typeof makeDeps>,
  config: Record<string, string | number | undefined> = {
    JOB_FEED_ENABLED: 'true',
  },
) => {
  return new JobFeedAutopilotTask(
    deps.collect as never,
    deps.score as never,
    deps.fetchDetail as never,
    deps.listNotifiable as never,
    deps.prisma as never,
    deps.jobPostingRepository as never,
    makeConfig(config) as never,
  );
};

describe('JobFeedAutopilotTask', () => {
  it('JOB_FEED_ENABLED 미설정이면 skip=true 이고 아무 유스케이스도 부르지 않는다', async () => {
    const deps = makeDeps();
    const task = buildTask(deps, {});

    const result = await task.run(CONTEXT);

    expect(result).toEqual({ skip: true });
    expect(deps.collect.execute).not.toHaveBeenCalled();
  });

  it('JOB_FEED_ENABLED=false 면 skip=true 이다', async () => {
    const deps = makeDeps();
    const task = buildTask(deps, { JOB_FEED_ENABLED: 'false' });

    const result = await task.run(CONTEXT);

    expect(result).toEqual({ skip: true });
  });

  it('커리어 프로필이 없으면 채점 없이 수집 결과만 요약한다', async () => {
    const deps = makeDeps({
      profile: null,
      collectResult: {
        outcomes: [],
        upsert: { created: 5, updated: 1, contentChanged: 0 },
        unmatchedSkillTags: [],
      },
    });
    const task = buildTask(deps);

    const result = await task.run(CONTEXT);

    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('커리어 프로필이 없어');
    expect(result.summaryText).toContain('5건');
    expect(deps.score.execute).not.toHaveBeenCalled();
    expect(deps.fetchDetail.execute).not.toHaveBeenCalled();
    expect(deps.listNotifiable.execute).not.toHaveBeenCalled();
    // 조기 반환 경로에서는 각주용 조회도 부르지 않는다 — 카드 자체가 없다.
    expect(
      deps.jobPostingRepository.findLastCollectedAt,
    ).not.toHaveBeenCalled();
  });

  it('프로필이 있으면 채점·상세수집·알림선점을 이어서 실행하고 마지막 수집 시각을 각주에 담는다', async () => {
    const lastCollectedAt = new Date('2026-08-27T22:00:00.000Z');
    const posting = {
      id: 1,
      source: 'jumpit',
      sourceId: '1',
      company: '토스',
      title: '백엔드 개발자',
      detailUrl: 'https://example.test/1',
      skillTags: ['Java'],
      rawSkillTags: [],
      minYears: 3,
      maxYears: 5,
      experienceLevel: 'mid',
      locations: ['서울'],
      normalizedKey: 'toss|백엔드개발자',
      jdText: null,
      matchScore: 80,
    };
    const deps = makeDeps({
      notifiablePostings: [posting],
      lastCollectedAt,
    });
    const task = buildTask(deps, {
      JOB_FEED_ENABLED: 'true',
      JOB_FEED_MATCH_THRESHOLD: 70,
      JOB_FEED_DETAIL_LIMIT: 5,
      JOB_FEED_LOCATIONS: '서울, 경기 ,',
      JOB_FEED_YEARS: 4,
    });

    const result = await task.run(CONTEXT);

    expect(deps.score.execute).toHaveBeenCalledWith({
      techTags: ['Java', 'Spring Boot'],
      years: 4,
      locations: ['서울', '경기'],
      profileId: 7,
    });
    expect(deps.fetchDetail.execute).toHaveBeenCalledWith({
      threshold: 70,
      limit: 5,
    });
    expect(deps.listNotifiable.execute).toHaveBeenCalledWith({
      threshold: 70,
      limit: 10,
    });
    expect(deps.jobPostingRepository.findLastCollectedAt).toHaveBeenCalled();
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('토스');
    expect(result.summaryText).toContain('마지막 수집');

    // fetchDetail 이 saveDetail 로 스킬을 채우며 채점 표식을 지운 행이 그날 안에
    // 반영되려면, fetchDetail 이후 채점이 한 번 더 돌아야 한다(원티드 65점 고정 재발 방지).
    expect(deps.score.execute).toHaveBeenCalledTimes(2);
    const secondScoreCallOrder = deps.score.execute.mock.invocationCallOrder[1];
    const fetchDetailCallOrder =
      deps.fetchDetail.execute.mock.invocationCallOrder[0];
    expect(secondScoreCallOrder).toBeGreaterThan(fetchDetailCallOrder);

    // owner 의 프로필만 조회해야 한다 — 다른 사용자가 더 최근에 만든 프로필로
    // 채점하면 안 된다.
    expect(deps.prisma.careerProfile.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slackUserId: 'U1' } }),
    );
  });

  it('JOB_FEED_MATCH_THRESHOLD·JOB_FEED_DETAIL_LIMIT 미설정이면 코드 기본값(80/20)을 쓴다', async () => {
    // app.config.ts 가 @Type(() => Number) + @IsInt/@Min/@Max 로 이미 값 형태를 보장하므로
    // (형식이 잘못되면 부팅 자체가 막힌다), 이 task 가 신경 쓸 나머지 경우는 "미설정"뿐이다.
    const deps = makeDeps();
    const task = buildTask(deps, { JOB_FEED_ENABLED: 'true' });

    await task.run(CONTEXT);

    expect(deps.fetchDetail.execute).toHaveBeenCalledWith({
      threshold: 80,
      limit: 20,
    });
    expect(deps.listNotifiable.execute).toHaveBeenCalledWith({
      threshold: 80,
      limit: 10,
    });
  });

  it('JOB_FEED_LOCATIONS 미설정이면 빈 배열을 넘긴다', async () => {
    const deps = makeDeps();
    const task = buildTask(deps, { JOB_FEED_ENABLED: 'true' });

    await task.run(CONTEXT);

    expect(deps.score.execute).toHaveBeenCalledWith(
      expect.objectContaining({ locations: [], years: null }),
    );
  });
});
