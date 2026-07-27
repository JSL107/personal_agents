import { isValidBeFixPrRef, parseBeFixPrRef } from './be-fix-pr-ref.parser';

describe('parseBeFixPrRef', () => {
  it('shorthand를 PullRequestRef로 파싱한다', () => {
    expect(parseBeFixPrRef('owner/repository#3')).toEqual({
      repo: 'owner/repository',
      number: 3,
    });
  });

  it('full GitHub URL을 PullRequestRef로 파싱한다', () => {
    expect(
      parseBeFixPrRef('https://github.com/owner/repository/pull/42'),
    ).toEqual({ repo: 'owner/repository', number: 42 });
  });

  it('number-only를 빈 repository PullRequestRef로 파싱한다', () => {
    expect(parseBeFixPrRef('123')).toEqual({ repo: '', number: 123 });
  });

  it('hash-number를 빈 repository PullRequestRef로 파싱한다', () => {
    expect(parseBeFixPrRef('#123')).toEqual({ repo: '', number: 123 });
  });

  it('자연어는 null을 반환한다', () => {
    expect(parseBeFixPrRef('최근 PR 봐줘')).toBeNull();
  });
});

describe('isValidBeFixPrRef', () => {
  it('파싱 성공 여부를 반환한다', () => {
    expect(isValidBeFixPrRef('owner/repository#3')).toBe(true);
    expect(
      isValidBeFixPrRef('https://github.com/owner/repository/pull/42'),
    ).toBe(true);
    expect(isValidBeFixPrRef('')).toBe(false);
    expect(isValidBeFixPrRef('그냥 텍스트')).toBe(false);
  });
});
