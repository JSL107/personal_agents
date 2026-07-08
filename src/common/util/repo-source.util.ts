export type RepoSource = 'company' | 'personal';

export const REPO_SOURCE_LABEL: Record<RepoSource, string> = {
  company: '회사 실무',
  personal: '개인 프로젝트(이대리)',
};

export const classifyRepoSource = (
  repositoryName: string,
  personalRepositories: string[],
): RepoSource => {
  const [owner] = repositoryName.toLowerCase().split('/');
  const normalizedRepositoryName = repositoryName.toLowerCase();

  const matched = personalRepositories.some((personalRepository) => {
    const normalizedPersonalRepository = personalRepository
      .trim()
      .toLowerCase();
    if (!normalizedPersonalRepository) {
      return false;
    }
    if (normalizedPersonalRepository === normalizedRepositoryName) {
      return true;
    }
    if (normalizedPersonalRepository.endsWith('/*')) {
      const patternOwner = normalizedPersonalRepository.slice(0, -2);
      return patternOwner === owner;
    }
    if (!normalizedPersonalRepository.includes('/')) {
      return normalizedPersonalRepository === owner;
    }
    return false;
  });

  return matched ? 'personal' : 'company';
};
