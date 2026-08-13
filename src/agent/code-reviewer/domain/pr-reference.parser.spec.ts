import { CodeReviewerException } from './code-reviewer.exception';
import { parsePrReference } from './pr-reference.parser';

describe('parsePrReference', () => {
  it.each([
    'https://github.com/JSL107/personal_agents/pull/290',
    '<https://github.com/JSL107/personal_agents/pull/290>',
    '<https://github.com/JSL107/personal_agents/pull/290> 리뷰해줘',
    'JSL107/personal_agents#290 리뷰해줘',
    'JSL107/personal_agents#290',
    '이 PR 좀 봐줘 <https://github.com/JSL107/personal_agents/pull/290>',
  ])('문장 안의 PR 참조 %s 를 파싱', (raw) => {
    expect(parsePrReference(raw)).toEqual({
      repo: 'JSL107/personal_agents',
      number: 290,
    });
  });

  it('http URL도 파싱', () => {
    expect(parsePrReference('http://github.com/foo/bar/pull/1')).toEqual({
      repo: 'foo/bar',
      number: 1,
    });
  });

  it('URL의 trailing path, query, fragment 뒤에서도 PR 번호까지만 파싱', () => {
    expect(parsePrReference('<https://github.com/o/r/pull/9/files>')).toEqual({
      repo: 'o/r',
      number: 9,
    });
    expect(
      parsePrReference('https://github.com/o/r/pull/9?diff=split#review'),
    ).toEqual({ repo: 'o/r', number: 9 });
  });

  it('Slack URL 표시문구를 제거하고 URL을 파싱', () => {
    expect(parsePrReference('<https://github.com/o/r/pull/9|PR 9>')).toEqual({
      repo: 'o/r',
      number: 9,
    });
  });

  it('여러 PR 참조 중 첫 번째를 반환', () => {
    expect(parsePrReference('먼저 o/r#1 보고 o/r#2 도')).toEqual({
      repo: 'o/r',
      number: 1,
    });
  });

  it('shorthand가 URL보다 먼저 나오면 shorthand를 반환', () => {
    expect(
      parsePrReference('foo/bar#1 그리고 https://github.com/o/r/pull/2'),
    ).toEqual({
      repo: 'foo/bar',
      number: 1,
    });
  });

  it('owner와 repo의 점, 하이픈, 밑줄을 허용', () => {
    expect(parsePrReference('org.name/repo-name_test#7')).toEqual({
      repo: 'org.name/repo-name_test',
      number: 7,
    });
  });

  it('URL 일부와 더 긴 문자열 안의 shorthand는 파싱하지 않는다', () => {
    expect(() => parsePrReference('https://example.com/foo/bar#7')).toThrow(
      CodeReviewerException,
    );
    expect(() => parsePrReference('foo/bar#7extra')).toThrow(
      CodeReviewerException,
    );
  });

  it('빈 문자열은 INVALID_PR_REFERENCE 예외', () => {
    expect(() => parsePrReference('')).toThrow(CodeReviewerException);
  });

  it('whitespace는 INVALID_PR_REFERENCE 예외', () => {
    expect(() => parsePrReference('   ')).toThrow(CodeReviewerException);
  });

  it('PR 참조가 없는 입력은 INVALID_PR_REFERENCE 예외', () => {
    expect(() => parsePrReference('리뷰해줘')).toThrow(CodeReviewerException);
    expect(() =>
      parsePrReference('https://github.com/foo/bar/issues/12'),
    ).toThrow(CodeReviewerException);
  });
});
