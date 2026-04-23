import { CodeReviewerException } from './code-reviewer.exception';
import { parsePrReference } from './pr-reference.parser';

describe('parsePrReference', () => {
  it('full URL https://github.com/owner/repo/pull/123 을 파싱', () => {
    const result = parsePrReference(
      'https://github.com/foo/bar/pull/123',
    );
    expect(result).toEqual({ repo: 'foo/bar', number: 123 });
  });

  it('http URL 도 허용', () => {
    const result = parsePrReference('http://github.com/foo/bar/pull/1');
    expect(result).toEqual({ repo: 'foo/bar', number: 1 });
  });

  it('trailing slash 도 허용', () => {
    const result = parsePrReference(
      'https://github.com/foo/bar/pull/42/',
    );
    expect(result).toEqual({ repo: 'foo/bar', number: 42 });
  });

  it('shorthand owner/repo#number 를 파싱', () => {
    const result = parsePrReference('foo/bar#7');
    expect(result).toEqual({ repo: 'foo/bar', number: 7 });
  });

  it('빈 문자열 / whitespace 는 INVALID_PR_REFERENCE 예외', () => {
    expect(() => parsePrReference('   ')).toThrow(CodeReviewerException);
  });

  it('이상한 입력은 INVALID_PR_REFERENCE 예외', () => {
    expect(() => parsePrReference('not a pr ref')).toThrow(
      CodeReviewerException,
    );
    expect(() =>
      parsePrReference('https://github.com/foo/bar/issues/1'),
    ).toThrow(CodeReviewerException);
    expect(() => parsePrReference('foo/bar')).toThrow(CodeReviewerException);
  });

  it('주변 공백 제거', () => {
    expect(parsePrReference('  foo/bar#7  ')).toEqual({
      repo: 'foo/bar',
      number: 7,
    });
  });
});
