import { CareerMateException } from './career-mate.exception';
import { CareerMateErrorCode } from './career-mate-error-code.enum';
import { extractPrReferences } from './extract-pr-reference';

describe('extractPrReferences', () => {
  it('단일 full URL 을 1건 배열로 추출한다 (하위호환)', () => {
    const text =
      '이 PR 회고 https://github.com/schoolbell-e/sbe-workspace/pull/1692 이력서에';
    expect(extractPrReferences(text)).toEqual([
      { repo: 'schoolbell-e/sbe-workspace', number: 1692 },
    ]);
  });

  it('shorthand(owner/repo#123) 를 추출한다', () => {
    expect(extractPrReferences('schoolbell-e/sbe-workspace#42 회고')).toEqual([
      { repo: 'schoolbell-e/sbe-workspace', number: 42 },
    ]);
  });

  it('여러 URL 을 등장 순서대로 전부 추출한다', () => {
    const text =
      '이 PR들 묶어서 https://github.com/o/r/pull/1 그리고 https://github.com/o/r/pull/2 회고';
    expect(extractPrReferences(text)).toEqual([
      { repo: 'o/r', number: 1 },
      { repo: 'o/r', number: 2 },
    ]);
  });

  it('URL 과 shorthand 혼합을 등장 순서로 추출한다', () => {
    const text = 'https://github.com/c/d/pull/2 그리고 a/b#1 도 같이';
    expect(extractPrReferences(text)).toEqual([
      { repo: 'c/d', number: 2 },
      { repo: 'a/b', number: 1 },
    ]);
  });

  it('같은 PR 이 중복되면 1건으로 dedup 한다', () => {
    const text =
      'https://github.com/o/r/pull/7 와 o/r#7 는 같은 PR https://github.com/o/r/pull/7';
    expect(extractPrReferences(text)).toEqual([{ repo: 'o/r', number: 7 }]);
  });

  it('MAX_PRS(8) 초과분은 앞에서부터 8건만 유지한다', () => {
    const text = Array.from(
      { length: 9 },
      (_unused, index) => `https://github.com/o/r/pull/${index + 1}`,
    ).join(' ');
    const refs = extractPrReferences(text);
    expect(refs).toHaveLength(8);
    expect(refs[0]).toEqual({ repo: 'o/r', number: 1 });
    expect(refs[7]).toEqual({ repo: 'o/r', number: 8 });
  });

  it('PR ref 가 없으면 INVALID_PR_REFERENCE 예외', () => {
    try {
      extractPrReferences('그냥 회고해줘');
      fail('예외가 발생해야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(CareerMateException);
      expect((error as CareerMateException).careerMateErrorCode).toBe(
        CareerMateErrorCode.INVALID_PR_REFERENCE,
      );
    }
  });
});
