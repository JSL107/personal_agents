import { classifyRepoSource, REPO_SOURCE_LABEL } from './repo-source.util';

describe('classifyRepoSource', () => {
  it('정확히 owner/repository 가 일치하면 personal 로 분류한다', () => {
    const result = classifyRepoSource('JSL107/personal_agents', [
      'JSL107/personal_agents',
    ]);

    expect(result).toBe('personal');
    expect(REPO_SOURCE_LABEL[result]).toBe('개인 프로젝트(이대리)');
  });

  it('대소문자 차이는 무시한다', () => {
    const result = classifyRepoSource('jsl107/personal_agents', [
      'JSL107/PERSONAL_AGENTS',
    ]);

    expect(result).toBe('personal');
  });

  it('owner/* 패턴이면 해당 owner 의 모든 repository 를 personal 로 분류한다', () => {
    const result = classifyRepoSource('JSL107/another-repository', [
      'JSL107/*',
    ]);

    expect(result).toBe('personal');
  });

  it('bare owner 패턴이면 해당 owner 의 모든 repository 를 personal 로 분류한다', () => {
    const result = classifyRepoSource('JSL107/personal_agents', ['JSL107']);

    expect(result).toBe('personal');
  });

  it('personalRepos 에 매칭되지 않으면 company 로 분류한다', () => {
    const result = classifyRepoSource('schoolbell-e/sbe-api-v5', [
      'JSL107/personal_agents',
    ]);

    expect(result).toBe('company');
    expect(REPO_SOURCE_LABEL[result]).toBe('회사 실무');
  });

  it('personalRepos 가 비어 있으면 모든 repository 를 company 로 분류한다', () => {
    const result = classifyRepoSource('JSL107/personal_agents', []);

    expect(result).toBe('company');
  });

  it('owner 가 authorLogin 과 같으면 personal 로 분류한다', () => {
    const result = classifyRepoSource('JSL107/personal_agents', [], 'JSL107');

    expect(result).toBe('personal');
  });

  it('owner 와 authorLogin 대소문자 차이는 무시한다', () => {
    const result = classifyRepoSource('jsl107/personal_agents', [], 'JSL107');

    expect(result).toBe('personal');
  });

  it('owner 가 authorLogin 과 다르고 personalRepos 에 없으면 company 로 분류한다', () => {
    const result = classifyRepoSource('schoolbell-e/sbe-api-v5', [], 'JSL107');

    expect(result).toBe('company');
  });

  it('owner 가 authorLogin 과 달라도 personalRepositories override 가 우선 유지된다', () => {
    const result = classifyRepoSource('org/private-tool', ['org/*'], 'JSL107');

    expect(result).toBe('personal');
  });

  it('authorLogin 없이 호출하면 기존 personalRepositories-only 동작을 유지한다', () => {
    const result = classifyRepoSource('JSL107/personal_agents', []);

    expect(result).toBe('company');
  });
});
