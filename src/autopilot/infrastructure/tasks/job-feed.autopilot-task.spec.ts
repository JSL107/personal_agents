import { Logger } from '@nestjs/common';

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
  agentRunId: 99,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  profileJson: {
    summary: '',
    skills: [],
    meta: { githubLogin: 'octocat', windowStart: '2026-07-01', prCount: 3 },
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
  const careerProfileRepository = {
    findLatestBySlackUser: jest
      .fn()
      .mockResolvedValue(
        'profile' in overrides ? overrides.profile : CAREER_PROFILE_WITH_TAGS,
      ),
  };
  const jobPostingRepository = {
    findLastCollectedAt: jest
      .fn()
      .mockResolvedValue(overrides.lastCollectedAt ?? new Date()),
    claimForNotification: jest.fn().mockResolvedValue(true),
  };
  return {
    collect,
    score,
    fetchDetail,
    listNotifiable,
    careerProfileRepository,
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
    deps.jobPostingRepository as never,
    deps.careerProfileRepository as never,
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
      avoidSkillTags: [],
    });
    expect(deps.listNotifiable.execute).toHaveBeenCalledWith({
      threshold: 70,
      limit: 10,
      avoidSkillTags: [],
    });
    expect(deps.jobPostingRepository.findLastCollectedAt).toHaveBeenCalled();
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('토스');
    expect(result.summaryText).toContain('마지막 수집');

    // run() 실행만으로는 아직 아무것도 선점하지 않는다 — 선점은 onDelivered 콜백
    // 안에서, 발송이 성공한 뒤에만 일어난다(orchestrator 가 그 시점에 호출한다).
    expect(
      deps.jobPostingRepository.claimForNotification,
    ).not.toHaveBeenCalled();
    expect(result.onDelivered).toBeInstanceOf(Function);

    await result.onDelivered?.();
    expect(deps.jobPostingRepository.claimForNotification).toHaveBeenCalledWith(
      'toss|백엔드개발자',
      expect.any(Date),
    );

    // fetchDetail 이 saveDetail 로 스킬을 채우며 채점 표식을 지운 행이 그날 안에
    // 반영되려면, fetchDetail 이후 채점이 한 번 더 돌아야 한다(원티드 65점 고정 재발 방지).
    expect(deps.score.execute).toHaveBeenCalledTimes(2);
    const secondScoreCallOrder = deps.score.execute.mock.invocationCallOrder[1];
    const fetchDetailCallOrder =
      deps.fetchDetail.execute.mock.invocationCallOrder[0];
    expect(secondScoreCallOrder).toBeGreaterThan(fetchDetailCallOrder);

    // owner 의 프로필만 조회해야 한다 — 다른 사용자가 더 최근에 만든 프로필로
    // 채점하면 안 된다. (포트 findLatestBySlackUser 가 이미 이 계약을 진다.)
    expect(
      deps.careerProfileRepository.findLatestBySlackUser,
    ).toHaveBeenCalledWith('U1');
  });

  it('프로필 JSON 에 accomplishments 가 없어도 죽지 않는다 — DB JSON 캐스팅은 런타임 보장이 아니다', async () => {
    const deps = makeDeps({
      profile: {
        id: 8,
        agentRunId: 1,
        createdAt: new Date(),
        // accomplishments 자체가 없는 손상된/구버전 행을 흉내낸다.
        profileJson: { summary: '', skills: [], meta: {} },
      },
    });
    const task = buildTask(deps);

    const result = await task.run(CONTEXT);

    // techTags 가 없으니 프로필 없음과 같은 경로(채점 skip)로 빠지되, 예외로 죽지는 않는다.
    expect(result.skip).toBe(false);
    expect(result.summaryText).toContain('커리어 프로필이 없어');
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
      avoidSkillTags: [],
    });
    expect(deps.listNotifiable.execute).toHaveBeenCalledWith({
      threshold: 80,
      limit: 10,
      avoidSkillTags: [],
    });
  });

  it('알림 후보가 없으면 onDelivered 를 아예 만들지 않는다 — 선점할 것이 없다', async () => {
    const deps = makeDeps({ notifiablePostings: [] });
    const task = buildTask(deps);

    const result = await task.run(CONTEXT);

    expect(result.onDelivered).toBeUndefined();
  });

  it('onDelivered 는 후보 각각을 normalizedKey 로 선점한다 — 중복 공고는 한 번만', async () => {
    const postingA = {
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
    const postingB = {
      ...postingA,
      id: 2,
      normalizedKey: 'danggeun|서버개발자',
    };
    const deps = makeDeps({ notifiablePostings: [postingA, postingB] });
    const task = buildTask(deps);

    const result = await task.run(CONTEXT);
    await result.onDelivered?.();

    expect(
      deps.jobPostingRepository.claimForNotification,
    ).toHaveBeenCalledTimes(2);
    expect(
      deps.jobPostingRepository.claimForNotification,
    ).toHaveBeenNthCalledWith(1, 'toss|백엔드개발자', expect.any(Date));
    expect(
      deps.jobPostingRepository.claimForNotification,
    ).toHaveBeenNthCalledWith(2, 'danggeun|서버개발자', expect.any(Date));
  });

  it('JOB_FEED_AVOID_SKILLS 를 정규화해 알림·상세수집 두 표면 모두에 같은 값으로 넘긴다', async () => {
    const deps = makeDeps();
    const task = buildTask(deps, {
      JOB_FEED_ENABLED: 'true',
      // 소문자·쉼표 구분 입력이 저장된 정규명(PHP·JSP)으로 정규화돼야 한다 —
      // 그러지 않으면 skillTags 와 정확히 비교하는 필터가 조용히 무효화된다.
      JOB_FEED_AVOID_SKILLS: 'php, jsp,',
    });

    await task.run(CONTEXT);

    // 두 표면이 각자 파싱하면 갈릴 수 있다 — 한 번만 계산해 재사용하는지 확인한다
    // (findDetailTargets 도 걸러야 기피 공고가 상세수집 예산을 대신 차지하지 않는다).
    expect(deps.listNotifiable.execute).toHaveBeenCalledWith(
      expect.objectContaining({ avoidSkillTags: ['PHP', 'JSP'] }),
    );
    expect(deps.fetchDetail.execute).toHaveBeenCalledWith(
      expect.objectContaining({ avoidSkillTags: ['PHP', 'JSP'] }),
    );
  });

  it('사전에 없는 기피 기술도 필터에 넘기되, 표기가 정확해야 걸린다는 사실을 로그로 남긴다', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const deps = makeDeps();
    const task = buildTask(deps, {
      JOB_FEED_ENABLED: 'true',
      // Cobol 은 사전에 없다. 예전에는 여기서 통째로 버려져 필터가 조용히 무효가 됐다
      // ("조용한 0건" 계열). 이제는 원본 표기 그대로 저장·비교되므로 넘기되, 표기가
      // 정확히 같은 공고만 걸린다는 반쪽 동작을 로그로 알린다.
      JOB_FEED_AVOID_SKILLS: 'php,Cobol',
    });

    await task.run(CONTEXT);

    expect(deps.listNotifiable.execute).toHaveBeenCalledWith(
      expect.objectContaining({ avoidSkillTags: ['PHP', 'Cobol'] }),
    );
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Cobol'));
    warning.mockRestore();
  });

  it('onDelivered 는 한 건이 선점에 실패해도 나머지를 계속 선점하고 실패 건수를 로그로 남긴다', async () => {
    const warning = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const postingA = {
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
    const postingB = {
      ...postingA,
      id: 2,
      normalizedKey: 'danggeun|서버개발자',
    };
    const postingC = { ...postingA, id: 3, normalizedKey: 'kakao|서버개발자' };
    const deps = makeDeps({
      notifiablePostings: [postingA, postingB, postingC],
    });
    // 두 번째 후보 선점만 실패한다 — 발송은 이미 끝났으니 나머지는 계속 선점돼야 한다.
    deps.jobPostingRepository.claimForNotification = jest
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('DB 연결 끊김'))
      .mockResolvedValueOnce(true);
    const task = buildTask(deps);

    const result = await task.run(CONTEXT);
    await expect(result.onDelivered?.()).resolves.toBeUndefined();

    expect(
      deps.jobPostingRepository.claimForNotification,
    ).toHaveBeenCalledTimes(3);
    expect(
      deps.jobPostingRepository.claimForNotification,
    ).toHaveBeenNthCalledWith(3, 'kakao|서버개발자', expect.any(Date));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('1건'));
    warning.mockRestore();
  });

  it('JOB_FEED_LOCATIONS 미설정이면 빈 배열을 넘긴다', async () => {
    const deps = makeDeps();
    const task = buildTask(deps, { JOB_FEED_ENABLED: 'true' });

    await task.run(CONTEXT);

    expect(deps.score.execute).toHaveBeenCalledWith(
      expect.objectContaining({ locations: [], years: null }),
    );
  });

  it('채점이 skip 되면 그 사유를 카드에 담는다 — "조용한 0건"을 다른 원인과 구분한다', async () => {
    const deps = makeDeps({
      scoreResult: {
        scored: 0,
        skipped: true,
        reason:
          '커리어 프로필에 사전과 맞는 기술 태그가 없어 채점을 건너뜁니다.',
        histogram: {},
        profileTokenCount: 0,
      },
    });
    const task = buildTask(deps);

    const result = await task.run(CONTEXT);

    expect(result.summaryText).toContain('채점 건너뜀');
    expect(result.summaryText).toContain(
      '커리어 프로필에 사전과 맞는 기술 태그가 없어 채점을 건너뜁니다.',
    );
  });
});
