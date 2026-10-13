import { isLearningRepo, isSelfRepo, SELF_REPO } from './learning-repo';

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
    expect(isSelfRepo('schoolbell-e/sbe-spinoff-workspace')).toBe(false);
    expect(isSelfRepo('DDD-Community/DDD_BE')).toBe(false);
    expect(isSelfRepo('')).toBe(false);
  });
});

describe('isLearningRepo', () => {
  it('허용 목록의 레포를 표기 차이와 무관하게 알아본다', () => {
    expect(isLearningRepo(SELF_REPO)).toBe(true);
    expect(isLearningRepo('schoolbell-e/sbe-spinoff-workspace')).toBe(true);
    expect(isLearningRepo(' Schoolbell-E/SBE-Spinoff-Workspace ')).toBe(true);
  });

  it('목록 밖 레포는 대상이 아니다', () => {
    // 규약이 표본이 작은 레포에 실리면 PR 한두 건 사정이 레포 성향으로 굳는다.
    expect(isLearningRepo('schoolbell-e/sbe-api-v5')).toBe(false);
    expect(isLearningRepo('schoolbell-e/sbe-spinoff-workspace-old')).toBe(
      false,
    );
    expect(isLearningRepo('')).toBe(false);
  });
});
