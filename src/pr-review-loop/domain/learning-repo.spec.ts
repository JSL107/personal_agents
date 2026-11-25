import {
  isLearningRepo,
  isSelfRepo,
  resolveLearningRepos,
  SELF_REPO,
} from './learning-repo';

describe('isSelfRepo', () => {
  it('자기 레포를 표기 차이와 무관하게 알아본다', () => {
    // GitHub 레포 이름은 대소문자를 구분하지 않는다. 카드의 repo 는 API 표기를 그대로
    // 담고, Slack 입력은 손으로 친 표기라 둘이 갈릴 수 있다.
    expect(isSelfRepo(SELF_REPO)).toBe(true);
    expect(isSelfRepo('jsl107/personal_agents')).toBe(true);
    expect(isSelfRepo('  JSL107/Personal_Agents  ')).toBe(true);
  });

  it('학습을 연 회사 레포도 자기 레포는 아니다', () => {
    // 손으로 적은 규약·diff 밖 맥락은 이 레포 사정 전제라 학습 대상이 늘어도 넓히지 않는다.
    expect(isSelfRepo('acme-corp/acme-workspace')).toBe(false);
    expect(isSelfRepo('DDD-Community/DDD_BE')).toBe(false);
    expect(isSelfRepo('')).toBe(false);
  });
});

describe('resolveLearningRepos', () => {
  it('설정이 없으면 자기 레포만 학습 대상이다', () => {
    expect(resolveLearningRepos(undefined)).toEqual([SELF_REPO]);
    expect(resolveLearningRepos(' , ')).toEqual([SELF_REPO]);
  });

  it('콤마 구분 레포를 자기 레포 뒤에 더하고 자기 레포는 겹치지 않게 한다', () => {
    expect(
      resolveLearningRepos(
        ' acme-corp/acme-workspace , jsl107/personal_agents',
      ),
    ).toEqual([SELF_REPO, 'acme-corp/acme-workspace']);
  });

  it('표기만 다른 중복 레포는 한 번만 넣는다', () => {
    expect(
      resolveLearningRepos('acme-corp/acme-workspace,Acme-Corp/Acme-Workspace'),
    ).toEqual([SELF_REPO, 'acme-corp/acme-workspace']);
  });
});

describe('isLearningRepo', () => {
  const learningRepos = resolveLearningRepos('acme-corp/acme-workspace');

  it('허용 목록의 레포를 표기 차이와 무관하게 알아본다', () => {
    expect(isLearningRepo({ repo: SELF_REPO, learningRepos })).toBe(true);
    expect(
      isLearningRepo({ repo: 'acme-corp/acme-workspace', learningRepos }),
    ).toBe(true);
    expect(
      isLearningRepo({ repo: ' Acme-Corp/Acme-Workspace ', learningRepos }),
    ).toBe(true);
  });

  it('목록 밖 레포는 대상이 아니다', () => {
    // 규약이 표본이 작은 레포에 실리면 PR 한두 건 사정이 레포 성향으로 굳는다.
    expect(isLearningRepo({ repo: 'acme-corp/acme-api', learningRepos })).toBe(
      false,
    );
    expect(
      isLearningRepo({ repo: 'acme-corp/acme-workspace-old', learningRepos }),
    ).toBe(false);
    expect(isLearningRepo({ repo: '', learningRepos })).toBe(false);
  });
});
