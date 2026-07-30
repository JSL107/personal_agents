import { repoFromCwd } from './repo-from-cwd';

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
