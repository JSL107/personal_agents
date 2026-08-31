import { groupPrRefsByRepo } from './group-pr-refs';

const pr = (
  repo: string,
  number: number,
): { repo: string; number: number } => ({
  repo,
  number,
});

describe('groupPrRefsByRepo', () => {
  it('회사 저장소와 개인 저장소를 서로 다른 그룹으로 가른다', () => {
    const { groups } = groupPrRefsByRepo([
      pr('schoolbell-e/sbe-api-v5', 10),
      pr('JSL107/personal_agents', 400),
      pr('schoolbell-e/sbe-api-v5', 11),
    ]);

    expect(groups).toEqual([
      {
        repo: 'schoolbell-e/sbe-api-v5',
        refs: ['schoolbell-e/sbe-api-v5#10', 'schoolbell-e/sbe-api-v5#11'],
      },
      { repo: 'JSL107/personal_agents', refs: ['JSL107/personal_agents#400'] },
    ]);
  });

  it('같은 소유자라도 저장소가 다르면 나눈다 (다른 시스템이므로)', () => {
    const { groups } = groupPrRefsByRepo([
      pr('schoolbell-e/sbe-api-v5', 1),
      pr('schoolbell-e/sbe-slack-bot', 2),
    ]);

    expect(groups.map((group) => group.repo)).toEqual([
      'schoolbell-e/sbe-api-v5',
      'schoolbell-e/sbe-slack-bot',
    ]);
  });

  it('같은 PR 이 두 번 들어와도 한 번만 담는다', () => {
    const { groups } = groupPrRefsByRepo([
      pr('schoolbell-e/sbe-api-v5', 7),
      pr('schoolbell-e/sbe-api-v5', 7),
    ]);

    expect(groups[0].refs).toEqual(['schoolbell-e/sbe-api-v5#7']);
  });

  it('PR 이 많은 그룹을 앞에 두고, 같은 수면 저장소 이름 순으로 고정한다', () => {
    const { groups } = groupPrRefsByRepo([
      pr('owner/b-repo', 1),
      pr('owner/a-repo', 2),
      pr('owner/c-repo', 3),
      pr('owner/c-repo', 4),
    ]);

    expect(groups.map((group) => group.repo)).toEqual([
      'owner/c-repo',
      'owner/a-repo',
      'owner/b-repo',
    ]);
  });

  it('그룹당 8건을 넘으면 잘라내고 제외 수를 드러낸다 (조용한 절삭 금지)', () => {
    const pullRequests = Array.from({ length: 10 }, (_, index) =>
      pr('owner/repo', index + 1),
    );

    const { groups, droppedRefCount } = groupPrRefsByRepo(pullRequests);

    expect(groups[0].refs).toHaveLength(8);
    expect(droppedRefCount).toBe(2);
  });

  it('그룹이 5개를 넘으면 제외하고 그 PR 수를 제외 수에 더한다', () => {
    const pullRequests = Array.from({ length: 7 }, (_, index) =>
      pr(`owner/repo-${index}`, index + 1),
    );

    const { groups, droppedRefCount } = groupPrRefsByRepo(pullRequests);

    expect(groups).toHaveLength(5);
    expect(droppedRefCount).toBe(2);
  });

  it('입력이 없으면 빈 그룹을 낸다', () => {
    expect(groupPrRefsByRepo([])).toEqual({ groups: [], droppedRefCount: 0 });
  });
});
