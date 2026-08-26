import { isSelfRepo, LEARNING_REPO } from './learning-repo';

describe('isSelfRepo', () => {
  it('학습 대상 레포를 표기 차이와 무관하게 알아본다', () => {
    // GitHub 레포 이름은 대소문자를 구분하지 않는다. 카드의 repo 는 API 표기를 그대로
    // 담고, Slack 입력은 손으로 친 표기라 둘이 갈릴 수 있다.
    expect(isSelfRepo(LEARNING_REPO)).toBe(true);
    expect(isSelfRepo('jsl107/personal_agents')).toBe(true);
    expect(isSelfRepo('  JSL107/Personal_Agents  ')).toBe(true);
  });

  it('다른 레포는 대상이 아니다', () => {
    // 규약이 남의 레포에 실리면 오탐 대신 정탐을 지운다 — 경계가 느슨해지면 안 된다.
    expect(isSelfRepo('DDD-Community/DDD_BE')).toBe(false);
    expect(isSelfRepo('JSL107/other-repo')).toBe(false);
    expect(isSelfRepo('')).toBe(false);
  });
});
