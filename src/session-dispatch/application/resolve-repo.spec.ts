import { resolveRepoFromGit } from './resolve-repo';

describe('resolveRepoFromGit', () => {
  it.each([
    ['https://github.com/JSL107/personal_agents.git', 'JSL107/personal_agents'],
    ['git@github.com:JSL107/personal_agents.git', 'JSL107/personal_agents'],
    [
      'https://github.com/schoolbell-e/sbe-api-v5.git',
      'schoolbell-e/sbe-api-v5',
    ],
  ])(
    'git remote %s에서 owner/repo 를 반환한다',
    (remoteUrl, expectedRepository) => {
      const runGit = jest.fn().mockReturnValue(remoteUrl);

      const repository = resolveRepoFromGit('/work/idaeri-worktree', runGit);

      expect(repository).toBe(expectedRepository);
    },
  );

  it.each([null, ''])(
    'git remote 결과가 %p이면 cwd basename으로 fallback한다',
    (remoteUrl) => {
      const runGit = jest.fn().mockReturnValue(remoteUrl);

      const repository = resolveRepoFromGit('/work/career-mate', runGit);

      expect(repository).toBe('career-mate');
    },
  );
});
