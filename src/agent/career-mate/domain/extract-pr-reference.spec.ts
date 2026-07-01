import { CareerMateException } from './career-mate.exception';
import { CareerMateErrorCode } from './career-mate-error-code.enum';
import { extractPrReference } from './extract-pr-reference';

describe('extractPrReference', () => {
  it('문장 안의 full URL 을 추출한다', () => {
    const text =
      '이 PR 회고해서 https://github.com/schoolbell-e/sbe-workspace/pull/1692 이력서에 녹여줘';
    expect(extractPrReference(text)).toEqual({
      repo: 'schoolbell-e/sbe-workspace',
      number: 1692,
    });
  });

  it('shorthand(owner/repo#123) 를 추출한다', () => {
    expect(extractPrReference('schoolbell-e/sbe-workspace#42 회고')).toEqual({
      repo: 'schoolbell-e/sbe-workspace',
      number: 42,
    });
  });

  it('URL 과 shorthand 가 같이 있으면 URL 을 우선한다', () => {
    const text = 'a/b#1 말고 https://github.com/c/d/pull/2 회고';
    expect(extractPrReference(text)).toEqual({ repo: 'c/d', number: 2 });
  });

  it('PR ref 가 없으면 INVALID_PR_REFERENCE 예외', () => {
    try {
      extractPrReference('그냥 회고해줘');
      fail('예외가 발생해야 한다');
    } catch (error) {
      expect(error).toBeInstanceOf(CareerMateException);
      expect((error as CareerMateException).careerMateErrorCode).toBe(
        CareerMateErrorCode.INVALID_PR_REFERENCE,
      );
    }
  });
});
