import { createHash } from 'node:crypto';

import { ProfileAccomplishment } from './career-mate.type';
import {
  assignToCard,
  baseFingerprint,
  buildMemberPrs,
  buildProcessLines,
  computeCoverHash,
  decideSortOrder,
  mergeGithubLink,
  planAdoption,
  shouldRegenerateCover,
} from './portfolio-sync-plan';
import { ProjectGroup } from './project-group';

const accomplishment = (
  title: string,
  bullet: string,
  pr: number,
  mergedAt: string | null,
  repo = 'example/service',
): ProfileAccomplishment => ({
  title,
  bullet,
  star: { situation: '', task: '', action: '', result: '' },
  techTags: [],
  evidence: [
    { repo, pr, mergedAt, url: `https://github.com/${repo}/pull/${pr}` },
  ],
});

const group = (
  accomplishments: ProfileAccomplishment[],
  anonymized = false,
): ProjectGroup => ({
  key: 'example-service',
  repo: 'example/service',
  anonymized,
  accomplishments,
  techStack: [],
  period: '',
  links: {},
});

describe('portfolio sync 계획 함수', () => {
  it('겹치는 PR이 최대인 카드에 배정하고 동률은 작은 topicIndex를 고른다', () => {
    const cards = [
      {
        slug: 'second',
        topicIndex: 2,
        memberPrs: ['example/service#1', 'example/service#2'],
      },
      { slug: 'first', topicIndex: 1, memberPrs: ['example/service#2'] },
    ];
    expect(
      assignToCard({
        accomplishmentPrs: ['example/service#1', 'example/service#2'],
        cards,
      }),
    ).toEqual({ card: cards[0], ambiguous: false });
    expect(
      assignToCard({ accomplishmentPrs: ['example/service#2'], cards }),
    ).toEqual({
      card: cards[1],
      ambiguous: true,
    });
    expect(
      assignToCard({ accomplishmentPrs: ['unknown'], cards: [cards[0]] }),
    ).toEqual({
      card: cards[0],
      ambiguous: false,
    });
    expect(
      assignToCard({ accomplishmentPrs: ['unknown'], cards: [] }),
    ).toBeNull();
  });

  it('모든 근거 저장소 PR을 소문자로 정렬하고 구성 해시만으로 재생성을 판정한다', () => {
    const memberPrs = buildMemberPrs([
      accomplishment('A', 'A', 2, null, 'Other/Repo'),
      accomplishment('B', 'B', 1, null, 'Example/Service'),
      accomplishment('A copy', 'A', 2, null, 'other/repo'),
    ]);
    expect(memberPrs).toEqual(['example/service#1', 'other/repo#2']);
    const hash = computeCoverHash(memberPrs);
    expect(hash).toBe(
      createHash('sha1')
        .update('example/service#1\nother/repo#2\ncover-v1')
        .digest('hex'),
    );
    expect(
      shouldRegenerateCover({ row: { coverOf: hash }, coverHash: hash }),
    ).toBe(false);
    expect(shouldRegenerateCover({ row: null, coverHash: hash })).toBe(true);
  });

  it('최신 머지와 PR 번호순으로 정렬하고 같은 제목은 한 줄만 남긴다', () => {
    const lines = buildProcessLines(
      group([
        accomplishment('A', '이전', 1, '2026-01-01T00:00:00Z'),
        accomplishment(' A ', ' 최신 ', 4, '2026-03-01T00:00:00Z'),
        accomplishment('B', '다음', 3, '2026-02-01T00:00:00Z'),
        accomplishment('C', 'null', 5, null),
        accomplishment('D', 'epoch', 9, '1970-01-01T00:00:00Z'),
      ]),
    );
    expect(lines).toEqual(['최신', '다음', 'epoch', 'null']);
  });

  it('최신 성과의 문장이 비어 있으면 같은 제목의 이전 유효 문장을 남긴다', () => {
    const lines = buildProcessLines(
      group([
        accomplishment('A', '이전 유효', 1, '2026-01-01T00:00:00Z'),
        accomplishment('A', '  ', 2, '2026-03-01T00:00:00Z'),
      ]),
    );
    expect(lines).toEqual(['이전 유효']);
  });

  it('과정은 10줄로 자르고 익명 문장의 복합 저장소 이름을 가린다', () => {
    const accomplishments = Array.from({ length: 12 }, (_, index) =>
      accomplishment(
        `제목${index}`,
        `example-backendconfig ${index}`,
        index + 1,
        null,
      ),
    );
    const lines = buildProcessLines(group(accomplishments, true));
    expect(lines).toHaveLength(10);
    expect(lines[0]).toBe('사내 저장소 11');
    expect(lines.join(' ')).not.toContain('example-backendconfig');
  });

  it('채택은 slug 집합이 같을 때만 행을 만들고 기존 표지 해시는 비운다', () => {
    const cards = [{ slug: 'a', repo: 'Example/A' }];
    const sites = [{ id: '42', slug: 'a', title: '기존 표지' }];
    expect(planAdoption({ cards, siteProjects: sites })).toEqual({
      rows: [
        {
          slug: 'a',
          siteProjectId: '42',
          repo: 'example/a',
          topicIndex: 1,
          memberPrs: [],
          coverOf: null,
        },
      ],
      table: [{ slug: 'a', siteProjectId: '42', title: '기존 표지' }],
    });
    expect(
      planAdoption({
        cards,
        siteProjects: [{ id: '43', slug: 'b', title: '다름' }],
      }).mismatch,
    ).toEqual({ onlyInPlan: ['a'], onlyOnSite: ['b'] });
  });

  it('기존 링크의 사용자 소유 키를 보존하며 github만 바꾼다', () => {
    const links = {
      video: 'https://example.org/video',
      github: 'https://github.com/old/repo',
    };
    expect(
      mergeGithubLink({
        links,
        repo: 'Example/Service',
        anonymized: false,
        isPublic: true,
      }),
    ).toEqual({
      video: links.video,
      github: 'https://github.com/Example/Service',
    });
    expect(
      mergeGithubLink({
        links,
        repo: 'Example/Service',
        anonymized: true,
        isPublic: true,
      }),
    ).toEqual({ video: links.video });
    expect(links.github).toBe('https://github.com/old/repo');
  });

  it('사람이 바꾼 정렬값은 보내지 않고 봇의 직전 값이면 목표값만 보낸다', () => {
    expect(
      decideSortOrder({
        action: 'create',
        target: 1,
        current: 0,
        lastSent: null,
      }),
    ).toEqual({ sortOrderSent: 1, sortOrderOwned: 1, keptByHuman: false });
    expect(
      decideSortOrder({ action: 'update', target: 1, current: 9, lastSent: 2 }),
    ).toEqual({ sortOrderSent: null, sortOrderOwned: null, keptByHuman: true });
    expect(
      decideSortOrder({ action: 'update', target: 1, current: 2, lastSent: 2 }),
    ).toEqual({ sortOrderSent: 1, sortOrderOwned: 1, keptByHuman: false });
    // 사이트 쓰기 뒤 DB 기록이 실패했던 회차: 사이트는 목표값, lastSent 는 옛 값
    expect(
      decideSortOrder({ action: 'update', target: 3, current: 3, lastSent: 7 }),
    ).toEqual({ sortOrderSent: null, sortOrderOwned: 3, keptByHuman: false });
    expect(
      decideSortOrder({
        action: 'update',
        target: 1,
        current: 1,
        lastSent: null,
      }),
    ).toEqual({ sortOrderSent: null, sortOrderOwned: 1, keptByHuman: false });
  });

  it('DB 행 순서와 무관하게 fingerprint가 같고 빈 테이블은 empty다', () => {
    const row = {
      slug: 'a',
      status: 'ACTIVE' as const,
      coverOf: null,
      memberPrs: ['example/a#1'],
      siteProjectId: '1',
      repo: 'example/a',
      topicIndex: 1,
      inheritPublished: false,
      lastSentSortOrder: null,
    };
    const other = { ...row, slug: 'b' };
    expect(baseFingerprint([row, other])).toBe(baseFingerprint([other, row]));
    expect(baseFingerprint([row, other])).not.toBe(baseFingerprint([row]));
    expect(baseFingerprint([])).toBe('empty');
  });
});
