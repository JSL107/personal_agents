import { repoFromCwd, repoFromRemoteUrl } from './repo-from-cwd';

describe('repoFromCwd', () => {
  it('절대경로의 마지막 세그먼트를 repo 로', () => {
    expect(repoFromCwd('/Users/me/work/career-mate')).toBe('career-mate');
  });

  it('말미 슬래시 무시', () => {
    expect(repoFromCwd('/Users/me/work/personal_agents/')).toBe(
      'personal_agents',
    );
  });

  it('빈 문자열/루트는 null', () => {
    expect(repoFromCwd('')).toBeNull();
    expect(repoFromCwd('/')).toBeNull();
  });
});

describe('repoFromRemoteUrl', () => {
  it.each([
    ['https://github.com/JSL107/personal_agents.git', 'JSL107/personal_agents'],
    [
      'https://github.com/JSL107/personal_agents.git/',
      'JSL107/personal_agents',
    ],
    ['https://github.com/JSL107/personal_agents', 'JSL107/personal_agents'],
    ['git@github.com:JSL107/personal_agents.git', 'JSL107/personal_agents'],
    [
      'ssh://git@github.com/JSL107/personal_agents.git',
      'JSL107/personal_agents',
    ],
    [
      'https://x-access-token:TOKEN@github.com/JSL107/personal_agents.git',
      'JSL107/personal_agents',
    ],
    // 조직 소유 repo — owner 가 본인 계정이 아니어도 보존해야 GitHub 검색이 유효하다.
    [
      'https://github.com/schoolbell-e/sbe-api-v5.git',
      'schoolbell-e/sbe-api-v5',
    ],
    ['git@github.com:schoolbell-e/sbe-api-v5.git', 'schoolbell-e/sbe-api-v5'],
  ])('%s에서 owner/repo 를 반환한다', (remoteUrl, expectedRepository) => {
    expect(repoFromRemoteUrl(remoteUrl)).toBe(expectedRepository);
  });

  it.each(['', '   ', 'https://github.com/', 'git@github.com:'])(
    'repo 세그먼트가 없는 %p는 null을 반환한다',
    (remoteUrl) => {
      expect(repoFromRemoteUrl(remoteUrl)).toBeNull();
    },
  );
});
