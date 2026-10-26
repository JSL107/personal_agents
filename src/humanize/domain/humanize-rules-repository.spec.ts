import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveHumanizeRulesRepoPath } from './humanize-rules-repository';

describe('resolveHumanizeRulesRepoPath', () => {
  const defaultPath = join(homedir(), '.claude/skills/humanize-korean');

  it('.env.example 처럼 값이 비어 있으면 기본 경로를 쓴다', () => {
    // 빈 문자열이 그대로 cwd 로 가면 spawn 은 서버를 띄운 저장소에서 git 을 돌린다.
    expect(resolveHumanizeRulesRepoPath('')).toBe(defaultPath);
  });

  it('설정이 없으면 기본 경로를 쓴다', () => {
    expect(resolveHumanizeRulesRepoPath(undefined)).toBe(defaultPath);
  });

  it('설정한 경로는 ~ 를 펼쳐 그대로 쓴다', () => {
    expect(resolveHumanizeRulesRepoPath('~/rules')).toBe(
      join(homedir(), 'rules'),
    );
    expect(resolveHumanizeRulesRepoPath('/srv/rules')).toBe('/srv/rules');
  });
});
