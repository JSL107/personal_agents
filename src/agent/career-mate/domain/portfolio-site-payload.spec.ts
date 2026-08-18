import { CareerProfileData } from './career-mate.type';
import {
  buildPortfolioSitePayload,
  buildProjectSlug,
} from './portfolio-site-payload';

const evidence = (
  pr: number,
  mergedAt: string,
  repo = 'JSL107/personal_agents',
) => ({
  repo,
  pr,
  url: `https://github.com/${repo}/pull/${pr}`,
  mergedAt,
});

const ACCOMPLISHMENT = {
  title: '백테스트 재생 루프',
  bullet: '과거를 재생해 매매 성적을 낸다',
  star: {
    situation: '규칙을 바꿔도 좋아졌는지 알 수 없었다',
    task: '평일·거래일 두 축으로 재생 루프를 설계',
    action: 'replay usecase 와 CLI 진입점을 구현',
    result: '규칙 변경의 성적 차이를 수치로 비교',
  },
  techTags: ['TypeScript', 'NestJS'],
  // 배열 순서와 시간 순서를 일부러 어긋나게 둔다 — slug 가 "첫 원소"가 아니라
  // "가장 이른 PR"을 쓰는지 확인하려면 그래야 한다.
  evidence: [
    evidence(315, '2026-09-02T01:00:00Z'),
    evidence(313, '2026-08-14T01:00:00Z'),
  ],
};

// 스킬은 카테고리 4종 중 3종만 채운다 — 빈 카테고리를 건너뛰며 order 가 이어지는지 보려면
// 하나는 비어 있어야 한다(TOOL 없음). FRAMEWORK 는 같은 이름을 숙련도만 달리 두 번 넣는다.
const profile = (): CareerProfileData => ({
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
    {
      name: 'NestJS',
      category: 'FRAMEWORK',
      proficiency: 'FAMILIAR',
      evidence: [evidence(311, '2026-08-10T01:00:00Z')],
    },
    {
      name: '결제 도메인',
      category: 'DOMAIN',
      proficiency: 'FAMILIAR',
      evidence: [evidence(311, '2026-08-10T01:00:00Z')],
    },
  ],
  accomplishments: [ACCOMPLISHMENT],
  meta: { githubLogin: 'JSL107', windowStart: '2026-06-01', prCount: 12 },
});

describe('buildProjectSlug', () => {
  it('가장 이른 PR 을 멱등 키로 쓴다 (제목이 흔들려도 같은 slug)', () => {
    // evidence 배열 순서가 아니라 mergedAt 최소값(313)이 기준이어야 한다.
    expect(buildProjectSlug(ACCOMPLISHMENT)).toBe('personal-agents-pr-313');
  });

  it('사이트 slugify 가 깎지 않는 형태로만 만든다', () => {
    const slug = buildProjectSlug({
      ...ACCOMPLISHMENT,
      evidence: [evidence(7, '2026-08-01T00:00:00Z', 'JSL107/My_Repo.v2')],
    });

    expect(slug).toBe('my-repo-v2-pr-7');
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('근거 PR 이 없으면 slug 를 만들지 않는다', () => {
    expect(buildProjectSlug({ ...ACCOMPLISHMENT, evidence: [] })).toBeNull();
  });
});

describe('buildPortfolioSitePayload', () => {
  it('STAR 를 사이트의 문제·과정·결과로 옮긴다', () => {
    const { projects } = buildPortfolioSitePayload(profile());

    expect(projects).toHaveLength(1);
    const [project] = projects;
    expect(project.problem).toBe('규칙을 바꿔도 좋아졌는지 알 수 없었다');
    expect(project.process).toEqual([
      '평일·거래일 두 축으로 재생 루프를 설계',
      'replay usecase 와 CLI 진입점을 구현',
    ]);
    expect(project.result).toBe('규칙 변경의 성적 차이를 수치로 비교');
    expect(project.summary).toBe('과거를 재생해 매매 성적을 낸다');
    expect(project.techStack).toEqual(['TypeScript', 'NestJS']);
    expect(project.links.github).toContain('/pull/313');
  });

  it('발행은 항상 비공개 초안이다 (공개는 사람이 누른다)', () => {
    const { projects } = buildPortfolioSitePayload(profile());

    expect(projects[0].published).toBe(false);
    expect(projects[0].featured).toBe(false);
  });

  it('기간은 근거 PR 의 KST 월 범위로 적는다', () => {
    const { projects } = buildPortfolioSitePayload(profile());

    // 2026-08-14 ~ 2026-09-02 (KST) → 두 달에 걸침
    expect(projects[0].period).toBe('2026.08 - 2026.09');
  });

  it('같은 달에 끝난 작업은 기간을 한 번만 적는다', () => {
    const { projects } = buildPortfolioSitePayload({
      ...profile(),
      accomplishments: [
        {
          ...ACCOMPLISHMENT,
          evidence: [evidence(313, '2026-08-14T01:00:00Z')],
        },
      ],
    });

    expect(projects[0].period).toBe('2026.08');
  });

  it('스킬을 카테고리별 그룹으로 묶고 중복 이름을 합친다', () => {
    const { skillGroups } = buildPortfolioSitePayload(profile());

    expect(skillGroups.map((group) => group.title)).toEqual([
      'Languages',
      'Frameworks',
      'Domains',
    ]);
    // NestJS 가 숙련도 다르게 두 번 들어와도 한 번만 실린다.
    expect(skillGroups[1].skills).toEqual(['NestJS']);
    // EXPERT 가 있는 그룹만 강조.
    expect(skillGroups[0].highlighted).toBe(true);
    expect(skillGroups[1].highlighted).toBe(false);
    // order 는 1부터 빈 카테고리를 건너뛰며 이어진다(TOOL 없음).
    expect(skillGroups.map((group) => group.order)).toEqual([1, 2, 3]);
  });

  it('근거 PR 이 없는 성과는 조용히 버리지 않고 세어 올린다', () => {
    const payload = buildPortfolioSitePayload({
      ...profile(),
      accomplishments: [
        ACCOMPLISHMENT,
        { ...ACCOMPLISHMENT, title: '근거 없는 성과', evidence: [] },
      ],
    });

    expect(payload.projects).toHaveLength(1);
    expect(payload.skippedTitles).toEqual(['근거 없는 성과']);
  });
});
