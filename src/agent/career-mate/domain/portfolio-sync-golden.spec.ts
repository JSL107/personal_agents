import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CareerProfileData } from './career-mate.type';
import { groupAccomplishments } from './portfolio-site-payload';
import {
  buildProcessLines,
  decideSortOrder,
  mergeGithubLink,
} from './portfolio-sync-plan';
import { normalizeTechStack } from './tech-stack.normalize';

interface SyntheticFixture {
  profile: CareerProfileData;
  siteProjects: { slug: string; data: { links: Record<string, unknown> } }[];
}

const fixture = JSON.parse(
  readFileSync(
    join(__dirname, '__fixtures__/portfolio-sync-synthetic.json'),
    'utf8',
  ),
) as SyntheticFixture;

describe('합성 프로필 계획 골든', () => {
  it('익명 카드와 공개 카드를 10줄·정규 기술·저장소 루트 링크·정렬값으로 만든다', () => {
    const { groups } = groupAccomplishments(fixture.profile, {
      anonymizedOwners: ['sampleco'],
    });
    const golden = groups.map((group, index) => {
      const site = fixture.siteProjects.find(
        (project) => project.slug === group.key,
      );
      return {
        slug: group.key,
        process: buildProcessLines(group),
        techStack: normalizeTechStack(
          group.accomplishments.map((item) => item.techTags),
        ).techStack,
        links: mergeGithubLink({
          links: site?.data.links ?? {},
          repo: group.repo,
          anonymized: group.anonymized,
          isPublic: !group.anonymized,
        }),
        sortOrder: decideSortOrder({
          action: 'create',
          target: index + 1,
          current: 0,
          lastSent: null,
        }).sortOrderSent,
      };
    });

    expect(golden).toMatchSnapshot();
  });
});
