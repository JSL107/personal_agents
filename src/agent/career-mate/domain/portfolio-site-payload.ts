import { formatKstDate } from '../../../common/util/kst-date.util';
import {
  AccomplishmentEvidence,
  CareerProfileData,
  ProfileAccomplishment,
  ProfileSkill,
  SkillCategory,
} from './career-mate.type';
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

export const buildProjectSlug = (
  accomplishment: ProfileAccomplishment,
): string | null => {
  const first = earliestEvidence(accomplishment.evidence);
  if (!first) {
    return null;
  }
  // owner 를 버리지 않는다 — 여러 저장소에서 PR 을 모으는 환경에서 owner 가 다른 동명 저장소가
  // 같은 PR 번호를 가지면(작은 번호대에서 흔하다) 두 성과가 같은 slug 를 얻는다. 그러면 첫
  // 실행은 유니크 제약으로 실패하고, 다음 실행부터는 같은 항목을 번갈아 PATCH 해 한쪽 내용이
  // 덮인다. repo 전체(owner/name)를 키에 넣어 그 경로를 없앤다.
  const segment = toSlugSegment(first.repo);
  if (!segment) {
    return null;
  }
  // 저장된 프로필은 보정 전 `pr: "#984"` 를 담고 있을 수 있다. 그대로 두면 사이트가 `#` 를
  // 깎아 저장해 우리 조회 키와 어긋나고, 같은 성과가 회차마다 새 항목으로 올라간다.
  const pr = toPrNumber(first.pr);
  // 숫자로 읽을 수 없으면 slug 를 만들지 않는다 — 그런 값들끼리 같은 slug 로 뭉치면 첫 발행은
  // 유니크 제약으로 실패하고 이후로는 한 항목을 번갈아 덮는다. 세어 올리는 쪽이 안전하다.
  if (!Number.isSafeInteger(pr) || pr <= 0) {
    return null;
  }
  return `${segment}-pr-${pr}`;
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

const toProjectPayload = (
  accomplishment: ProfileAccomplishment,
): PortfolioSiteProjectPayload | null => {
  const slug = buildProjectSlug(accomplishment);
  if (!slug) {
    return null;
  }
  const first = earliestEvidence(accomplishment.evidence);
  const { star } = accomplishment;
  return {
    slug,
    title: accomplishment.title,
    summary: accomplishment.bullet,
    problem: star.situation,
    // 과제(task)와 행동(action)을 과정 두 줄로 펼친다. 빈 항목은 싣지 않는다.
    process: [star.task, star.action].filter((step) => step.trim().length > 0),
    result: star.result,
    techStack: accomplishment.techTags,
    period: buildPeriod(accomplishment.evidence),
    links: first ? { github: first.url } : {},
    published: false,
    featured: false,
  };
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
}

// 경력 프로필(STAR 서술) → 사이트 프로젝트·스킬 그룹. 순수 변환이라 네트워크를 모른다.
export const buildPortfolioSitePayload = (
  profile: CareerProfileData,
): PortfolioSitePayload => {
  const projects: PortfolioSiteProjectPayload[] = [];
  const skippedTitles: string[] = [];
  for (const accomplishment of profile.accomplishments) {
    const payload = toProjectPayload(accomplishment);
    if (payload) {
      projects.push(payload);
      continue;
    }
    skippedTitles.push(accomplishment.title);
  }
  return {
    projects,
    skillGroups: toSkillGroupPayloads(profile.skills),
    skippedTitles,
  };
};
