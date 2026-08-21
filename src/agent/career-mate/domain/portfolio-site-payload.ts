import { createHash } from 'node:crypto';

import { formatKstDate } from '../../../common/util/kst-date.util';
import {
  AccomplishmentEvidence,
  CareerProfileData,
  ProfileAccomplishment,
  ProfileSkill,
  SkillCategory,
} from './career-mate.type';
import { ProjectGroup, ProjectGroupNaming } from './project-group';
import { toPrNumber } from './reconcile-accomplishment-evidence';

// 사이트(Portfolio OS)의 프로젝트 1건에 보낼 본문. 사이트는 이 객체를 그대로 jsonb 로 저장하고
// title·slug·published·sortOrder 만 컬럼으로 뽑아 쓴다 (portfolio 레포 content.service.ts).
export interface PortfolioSiteProjectPayload {
  slug: string;
  title: string;
  summary: string;
  problem: string;
  process: string[];
  result: string;
  techStack: string[];
  period: string;
  links: Record<string, string>;
  // 사람이 편집기에서 "게시"를 누를 때까지 공개하지 않는다. 자동 발행이 곧 공개가 되면
  // 되돌리기 어려운 쪽을 기계에 맡기는 셈이다.
  published: false;
  featured: false;
}

export interface PortfolioSiteSkillGroupPayload {
  title: string;
  skills: string[];
  order: number;
  highlighted: boolean;
}

// 공개 포트폴리오에 저장소 이름을 남기지 않을 owner 들. 사내 저장소가 여기 해당한다.
// 코드에 이름을 박으면 이 저장소가 공개라 그 자체로 노출되므로 설정(.env)에서만 받는다.
export interface PortfolioSitePayloadOptions {
  anonymizedOwners: string[];
}

const EMPTY_OPTIONS: PortfolioSitePayloadOptions = { anonymizedOwners: [] };

const ownerOf = (repo: string): string =>
  repo.split('/')[0]?.trim().toLowerCase() ?? '';

const isAnonymized = (
  repo: string,
  { anonymizedOwners }: PortfolioSitePayloadOptions,
): boolean => anonymizedOwners.includes(ownerOf(repo));

// 익명 저장소 식별자. 저장소 경로를 해시로 접어 이름을 지우되, 같은 저장소는 항상 같은 값이
// 되게 한다 — slug 는 멱등 키라 회차마다 흔들리면 같은 성과가 새 항목으로 다시 올라간다.
const anonymousRepoSegment = (repo: string): string =>
  `company-${createHash('sha1').update(repo.trim().toLowerCase()).digest('hex').slice(0, 6)}`;

// GitHub 자체가 2008년에 생겼으므로 그 이전 머지 시각은 실재할 수 없다. 근거 PR 의 mergedAt 은
// LLM 합성 결과라(career-profile-synth.prompt.ts) 머지 시각이 "미상" 인 PR 에 모델이 epoch 를
// 지어 넣는 일이 있고, 실제로 사이트에 `1970.01` 로 발행됐다. 값을 없는 것으로 되돌린다.
//
// 저장 시점이 아니라 여기서 거르는 이유 — 이미 저장된 프로필이 매 회차 그대로 다시 쓰이므로
// (publish-portfolio-site.usecase 의 resolveProfile) 생성 경로만 고쳐서는 소급되지 않는다.
const EARLIEST_PLAUSIBLE_MERGED_AT = Date.UTC(2008, 0, 1);

const sanitizeMergedAt = (mergedAt: string | null): string | null => {
  if (!mergedAt) {
    return null;
  }
  const parsed = new Date(mergedAt).getTime();
  if (Number.isNaN(parsed) || parsed < EARLIEST_PLAUSIBLE_MERGED_AT) {
    return null;
  }
  return mergedAt;
};

// 정렬(첫 PR 선정)과 기간 표기가 같은 정화본을 보게 한 번만 걸러 둔다. 한쪽만 거르면 기간은
// 비었는데 slug 는 엉뚱한 PR 로 잡히는 어긋남이 남는다.
const sanitizeEvidence = (
  evidence: AccomplishmentEvidence[],
): AccomplishmentEvidence[] =>
  evidence.map((item) => ({
    ...item,
    mergedAt: sanitizeMergedAt(item.mergedAt),
  }));

// 카테고리 → 사이트 스킬 그룹 제목. 순서가 곧 사이트 표시 순서(order)다.
const SKILL_GROUP_TITLES: { category: SkillCategory; title: string }[] = [
  { category: 'LANGUAGE', title: 'Languages' },
  { category: 'FRAMEWORK', title: 'Frameworks' },
  { category: 'DOMAIN', title: 'Domains' },
  { category: 'TOOL', title: 'Tools' },
];

// 성과 서술에는 근거 PR 이 붙어 있어서, 그중 가장 이른 PR 을 멱등 키로 쓴다.
// 제목(LLM 생성)을 키로 쓰면 회차마다 문구가 흔들려 같은 성과가 새 항목으로 또 올라간다.
const earliestEvidence = (
  evidence: AccomplishmentEvidence[],
): AccomplishmentEvidence | null => {
  const sorted = [...evidence].sort((left, right) => {
    if (left.mergedAt === null && right.mergedAt !== null) {
      return 1;
    }
    if (left.mergedAt !== null && right.mergedAt === null) {
      return -1;
    }
    // 둘 다 값이 있으면 이른 머지 시각이 앞이다 — "성과의 첫 PR" 이 slug 의 정의다.
    if (
      left.mergedAt !== null &&
      right.mergedAt !== null &&
      left.mergedAt !== right.mergedAt
    ) {
      return left.mergedAt < right.mergedAt ? -1 : 1;
    }
    return toPrNumber(left.pr) - toPrNumber(right.pr);
  });
  return sorted[0] ?? null;
};

// 사이트 slugify 는 [a-z0-9가-힣] 과 하이픈만 남긴다. 여기서 미리 그 형태로 만들어
// 사이트가 우리 slug 를 다시 깎지 않게 한다 (깎이면 멱등 조회가 어긋난다).
const toSlugSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// 성과가 속한 저장소. 근거 PR 이 하나도 없으면 어느 저장소인지 알 수 없어 묶을 수 없다.
export const repoOf = (
  accomplishment: ProfileAccomplishment,
): string | null => {
  const first = earliestEvidence(sanitizeEvidence(accomplishment.evidence));
  return first?.repo.trim() || null;
};

// 저장소 → 사이트 slug. 저장소가 같으면 회차가 달라도 같은 값이라 멱등 키가 된다.
//
// PR 번호를 키에 넣지 않는다 — 넣으면 저장소 하나의 작업이 PR 수만큼 별개 프로젝트로 흩어진다.
// owner 를 버리지도 않는다. owner 가 다른 동명 저장소가 한 항목을 번갈아 덮어쓰기 때문이다.
export const buildGroupKey = (
  repo: string,
  options: PortfolioSitePayloadOptions = EMPTY_OPTIONS,
): string | null => {
  const segment = isAnonymized(repo, options)
    ? anonymousRepoSegment(repo)
    : toSlugSegment(repo);
  return segment || null;
};

// 근거 PR 들의 머지 시점을 KST 월로 환산해 기간 문구를 만든다.
const buildPeriod = (evidence: AccomplishmentEvidence[]): string => {
  const months = evidence
    .map((item) => formatKstDate(item.mergedAt))
    .filter((date): date is string => date !== null)
    .map((date) => date.slice(0, 7).replace('-', '.'))
    .sort();
  if (months.length === 0) {
    return '';
  }
  const first = months[0];
  const last = months[months.length - 1];
  return first === last ? first : `${first} - ${last}`;
};

const toSkillGroupPayloads = (
  skills: ProfileSkill[],
): PortfolioSiteSkillGroupPayload[] => {
  const payloads: PortfolioSiteSkillGroupPayload[] = [];
  for (const { category, title } of SKILL_GROUP_TITLES) {
    const inCategory = skills.filter((skill) => skill.category === category);
    if (inCategory.length === 0) {
      continue;
    }
    payloads.push({
      title,
      skills: [...new Set(inCategory.map((skill) => skill.name))],
      order: payloads.length + 1,
      highlighted: inCategory.some((skill) => skill.proficiency === 'EXPERT'),
    });
  }
  return payloads;
};

export interface PortfolioSitePayload {
  projects: PortfolioSiteProjectPayload[];
  skillGroups: PortfolioSiteSkillGroupPayload[];
  // 근거 PR 이 없어 멱등 키를 만들 수 없던 성과. 조용히 사라지지 않게 세어 올린다.
  skippedTitles: string[];
  // 모델이 이름을 돌려주지 않아 발행하지 못한 그룹 키. 조용히 사라지면 저장소 하나가 통째로
  // 빠진 것을 아무도 모른다.
  unnamedKeys: string[];
}

// 프로필의 성과들을 저장소 단위로 묶는다. 순수 변환이라 네트워크도 모델도 모른다.
//
// 묶는 이유 — 성과는 PR 단위로 누적되기만 하므로(merge-accomplishment) 성과 1개를 프로젝트
// 1개로 발행하면 저장소 하나가 수십 건으로 흩어지고, 제목도 서로 구분되지 않는다.
export const groupAccomplishments = (
  profile: CareerProfileData,
  options: PortfolioSitePayloadOptions = EMPTY_OPTIONS,
): { groups: ProjectGroup[]; skippedTitles: string[] } => {
  const byKey = new Map<string, ProjectGroup>();
  const skippedTitles: string[] = [];

  for (const accomplishment of profile.accomplishments) {
    const repo = repoOf(accomplishment);
    const key = repo ? buildGroupKey(repo, options) : null;
    if (!repo || !key) {
      skippedTitles.push(accomplishment.title);
      continue;
    }
    const found = byKey.get(key);
    if (found) {
      found.accomplishments.push(accomplishment);
      continue;
    }
    byKey.set(key, {
      key,
      repo,
      anonymized: isAnonymized(repo, options),
      accomplishments: [accomplishment],
      techStack: [],
      period: '',
      links: {},
    });
  }

  // 묶고 나서 한 번에 계산한다 — 기간·스택은 그룹 전체를 봐야 정해진다.
  const groups: ProjectGroup[] = [...byKey.values()].map((group) => {
    const evidence = group.accomplishments.flatMap((item) =>
      sanitizeEvidence(item.evidence),
    );
    const first = earliestEvidence(evidence);
    const links: Record<string, string> =
      first && !group.anonymized ? { github: first.url } : {};
    return {
      ...group,
      techStack: [
        ...new Set(group.accomplishments.flatMap((item) => item.techTags)),
      ],
      period: buildPeriod(evidence),
      links,
    };
  });
  // 작업이 많은 저장소가 앞이다 — 사이트가 sortOrder 없이 받은 순서를 쓰므로 여기서 정한다.
  groups.sort(
    (left, right) => right.accomplishments.length - left.accomplishments.length,
  );
  return { groups, skippedTitles };
};

// 그룹 + 모델이 지은 이름 → 사이트 프로젝트. 이름이 없는 그룹은 싣지 않는다(제목 없는
// 프로젝트를 발행하느니 빠뜨린 것을 세어 올리는 쪽이 낫다).
export const buildPortfolioSitePayload = ({
  profile,
  groups,
  namings,
  skippedTitles,
}: {
  profile: CareerProfileData;
  groups: ProjectGroup[];
  namings: ProjectGroupNaming[];
  skippedTitles: string[];
}): PortfolioSitePayload => {
  const namingByKey = new Map(namings.map((naming) => [naming.key, naming]));
  const projects: PortfolioSiteProjectPayload[] = [];
  const unnamedKeys: string[] = [];

  for (const group of groups) {
    const naming = namingByKey.get(group.key);
    if (!naming) {
      unnamedKeys.push(group.key);
      continue;
    }
    projects.push({
      slug: group.key,
      title: naming.title,
      summary: naming.summary,
      problem: naming.problem,
      // 과정은 성과 bullet 을 그대로 쓴다 — 여기까지 모델이 다시 쓰면 개별 작업의 사실이
      // 요약에 녹아 사라진다. 묶는 것은 표지이지 내용이 아니다.
      process: group.accomplishments
        .map((item) => item.bullet.trim())
        .filter((bullet) => bullet.length > 0),
      result: naming.result,
      techStack: group.techStack,
      period: group.period,
      links: group.links,
      published: false,
      featured: false,
    });
  }

  return {
    projects,
    skillGroups: toSkillGroupPayloads(profile.skills),
    skippedTitles,
    unnamedKeys,
  };
};
