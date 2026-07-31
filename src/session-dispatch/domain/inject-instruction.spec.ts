import {
  injectInstructionForCiFailure,
  injectInstructionForPr,
} from './inject-instruction';

describe('injectInstructionForPr', () => {
  it('prRef 를 담은 리뷰 지시문 생성', () => {
    const text = injectInstructionForPr('octo/repo#42');

    expect(text).toContain('octo/repo#42');
    expect(text.length).toBeGreaterThan(0);
  });
});

describe('injectInstructionForCiFailure', () => {
  it('실패 체크명·저장소·커밋·URL을 담은 자기완결형 수정 지시를 만든다', () => {
    const result = injectInstructionForCiFailure({
      repo: 'me/repo',
      checkName: 'verify',
      headSha: 'a1b2c3d4e5f6',
      htmlUrl: 'https://github.com/me/repo/runs/1',
    });
    expect(result).toContain('verify');
    expect(result).toContain('me/repo');
    expect(result).toContain('a1b2c3d');
    expect(result).toContain('https://github.com/me/repo/runs/1');
    expect(result).toContain('수정');
  });
});
