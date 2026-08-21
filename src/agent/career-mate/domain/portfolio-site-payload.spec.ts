import { CareerProfileData } from './career-mate.type';
import {
  buildGroupKey,
  buildPortfolioSitePayload,
  groupAccomplishments,
} from './portfolio-site-payload';
import { ProjectGroupNaming } from './project-group';

const evidence = (
  pr: number,
  mergedAt: string | null,
  repo = 'JSL107/personal_agents',
) => ({
  repo,
  pr,
  url: `https://github.com/${repo}/pull/${pr}`,
  mergedAt,
});

const accomplishment = (
  title: string,
  evidenceList: ReturnType<typeof evidence>[],
  techTags: string[] = ['TypeScript'],
) => ({
  title,
  bullet: `${title} — 이력서 한 줄`,
  star: {
    situation: `${title} 상황`,
    task: `${title} 과제`,
    action: `${title} 행동`,
    result: `${title} 결과`,
  },
  techTags,
  evidence: evidenceList,
});

const profile = (
  accomplishments: ReturnType<typeof accomplishment>[],
): CareerProfileData => ({
  summary: '백엔드 중심 개발자',
  skills: [
    {
      name: 'TypeScript',
      category: 'LANGUAGE',
      proficiency: 'EXPERT',
      evidence: [evidence(313, '2026-08-14T01:00:00Z')],
    },
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'PROFICIENT',
      evidence: [evidence(313, '2026-08-14T01:00:00Z')],
    },
  ],
  accomplishments,
  meta: { githubLogin: 'JSL107', windowStart: '2026-06-01', prCount: 12 },
});

const naming = (key: string): ProjectGroupNaming => ({
  key,
  title: `${key} 프로젝트`,
  summary: '한 문장 소개',
  problem: '반복해서 다룬 문제',
  result: '달라진 결과',
});

describe('groupAccomplishments', () => {
  it('같은 저장소의 작업을 한 묶음으로 모은다', () => {
    // 묶지 않으면 저장소 하나가 PR 수만큼 별개 프로젝트로 흩어진다 — 이 규칙이 이 변경의 핵심.
    const { groups } = groupAccomplishments(
      profile([
        accomplishment('A', [evidence(313, '2026-08-14T01:00:00Z')]),
        accomplishment('B', [evidence(315, '2026-09-02T01:00:00Z')]),
        accomplishment('C', [
          evidence(70, '2026-07-01T01:00:00Z', 'DDD-Community/ddd-be'),
        ]),
      ]),
    );

    expect(groups).toHaveLength(2);
    const mine = groups.find((group) => group.key === 'jsl107-personal-agents');
    expect(mine?.accomplishments.map((item) => item.title)).toEqual(['A', 'B']);
  });

  it('작업이 많은 묶음이 앞에 온다', () => {
    // 사이트는 받은 순서를 그대로 쓰므로 정렬이 여기서 정해지지 않으면 노출 순서가 흔들린다.
    const { groups } = groupAccomplishments(
      profile([
        accomplishment('혼자', [
          evidence(70, '2026-07-01T01:00:00Z', 'DDD-Community/ddd-be'),
        ]),
        accomplishment('A', [evidence(313, '2026-08-14T01:00:00Z')]),
        accomplishment('B', [evidence(315, '2026-09-02T01:00:00Z')]),
      ]),
    );

    expect(groups.map((group) => group.key)).toEqual([
      'jsl107-personal-agents',
      'ddd-community-ddd-be',
    ]);
  });

  it('기간은 묶음 전체를 훑고, 기술은 합집합이다', () => {
    const { groups } = groupAccomplishments(
      profile([
        accomplishment(
          'A',
          [evidence(313, '2026-06-14T01:00:00Z')],
          ['TypeScript', 'NestJS'],
        ),
        accomplishment(
          'B',
          [evidence(315, '2026-09-02T01:00:00Z')],
          ['NestJS', 'Prisma'],
        ),
      ]),
    );

    expect(groups[0].period).toBe('2026.06 - 2026.09');
    expect(groups[0].techStack).toEqual(['TypeScript', 'NestJS', 'Prisma']);
  });

  it('근거 PR 이 없는 작업은 묶지 못하고 세어 올린다', () => {
    // 조용히 사라지면 성과 하나가 통째로 빠진 것을 아무도 모른다.
    const { groups, skippedTitles } = groupAccomplishments(
      profile([
        accomplishment('근거없음', []),
        accomplishment('A', [evidence(313, '2026-08-14T01:00:00Z')]),
      ]),
    );

    expect(skippedTitles).toEqual(['근거없음']);
    expect(groups).toHaveLength(1);
  });
});

describe('사내 저장소 익명화', () => {
  const WORK = 'acme-corp/internal-api';
  const options = { anonymizedOwners: ['acme-corp'] };

  it('묶음 키에 저장소 이름이 남지 않는다', () => {
    const key = buildGroupKey(WORK, options);

    expect(key).not.toContain('acme');
    expect(key).not.toContain('internal-api');
    expect(key).toMatch(/^company-[0-9a-f]{6}$/);
  });

  it('익명화 목록에 없으면 저장소 이름을 그대로 쓴다', () => {
    // 대조군 — 무차별로 익명화하면 개인 저장소 근거까지 끊긴다.
    expect(buildGroupKey(WORK, { anonymizedOwners: [] })).toBe(
      'acme-corp-internal-api',
    );
  });

  it('같은 저장소는 항상 같은 키를 얻는다', () => {
    // 키는 멱등 키다. 회차마다 흔들리면 같은 프로젝트가 사이트에 계속 새로 쌓인다.
    expect(buildGroupKey(WORK, options)).toBe(buildGroupKey(WORK, options));
  });

  it('저장소가 다르면 키도 다르다', () => {
    expect(buildGroupKey('acme-corp/other-api', options)).not.toBe(
      buildGroupKey(WORK, options),
    );
  });

  it('익명 묶음은 PR 링크를 싣지 않는다', () => {
    const { groups } = groupAccomplishments(
      profile([
        accomplishment('A', [evidence(984, '2026-07-01T01:00:00Z', WORK)]),
      ]),
      options,
    );

    // 링크가 남으면 키를 아무리 접어도 주소에서 저장소가 그대로 드러난다.
    expect(groups[0].links).toEqual({});
    expect(groups[0].anonymized).toBe(true);
  });

  it('익명화하지 않는 묶음은 링크를 유지한다', () => {
    const { groups } = groupAccomplishments(
      profile([accomplishment('A', [evidence(313, '2026-08-14T01:00:00Z')])]),
      options,
    );

    expect(groups[0].links).toEqual({
      github: 'https://github.com/JSL107/personal_agents/pull/313',
    });
  });
});

describe('실재할 수 없는 머지 시각', () => {
  // LLM 이 머지 시각 "미상" 인 PR 에 epoch 를 지어 넣어 사이트에 `1970.01` 로 발행된 적이 있다.
  const EPOCH = '1970-01-01T00:00:00.000Z';

  it('기간 표기에서 제외한다', () => {
    const { groups } = groupAccomplishments(
      profile([accomplishment('A', [evidence(313, EPOCH)])]),
    );

    expect(groups[0].period).toBe('');
  });

  it('대표 링크 선정을 오염시키지 않는다', () => {
    // epoch 를 그대로 두면 그 PR 이 "첫 PR" 로 뽑혀 링크가 엉뚱한 곳을 가리킨다.
    const { groups } = groupAccomplishments(
      profile([
        accomplishment('A', [
          evidence(984, EPOCH),
          evidence(313, '2026-08-14T01:00:00Z'),
        ]),
      ]),
    );

    expect(groups[0].links).toEqual({
      github: 'https://github.com/JSL107/personal_agents/pull/313',
    });
    expect(groups[0].period).toBe('2026.08');
  });
});

describe('buildPortfolioSitePayload', () => {
  const built = (namings: ProjectGroupNaming[]) => {
    const { groups, skippedTitles } = groupAccomplishments(
      profile([
        accomplishment('A', [evidence(313, '2026-08-14T01:00:00Z')]),
        accomplishment('B', [evidence(315, '2026-09-02T01:00:00Z')]),
      ]),
    );
    return buildPortfolioSitePayload({
      profile: profile([]),
      groups,
      namings,
      skippedTitles,
    });
  };

  it('모델이 지은 이름을 표지로 쓰고 작업은 과정으로 내린다', () => {
    const payload = built([naming('jsl107-personal-agents')]);

    expect(payload.projects).toHaveLength(1);
    const [project] = payload.projects;
    expect(project.slug).toBe('jsl107-personal-agents');
    expect(project.title).toBe('jsl107-personal-agents 프로젝트');
    // 과정은 작업 bullet 그대로다 — 여기까지 모델이 다시 쓰면 개별 작업의 사실이 사라진다.
    expect(project.process).toEqual(['A — 이력서 한 줄', 'B — 이력서 한 줄']);
    expect(project.published).toBe(false);
  });

  it('이름이 없는 묶음은 발행하지 않고 세어 올린다', () => {
    // 제목 없는 카드를 내보내느니 빠뜨린 것을 드러내는 편이 낫다.
    const payload = built([]);

    expect(payload.projects).toHaveLength(0);
    expect(payload.unnamedKeys).toEqual(['jsl107-personal-agents']);
  });

  it('입력에 없는 묶음 이름은 쓰지 않는다', () => {
    const payload = built([naming('지어낸-키')]);

    expect(payload.projects).toHaveLength(0);
    expect(payload.unnamedKeys).toEqual(['jsl107-personal-agents']);
  });
});
