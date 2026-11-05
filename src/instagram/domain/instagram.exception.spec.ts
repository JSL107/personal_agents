import { InstagramException, toInstagramError } from './instagram.exception';
import { InstagramErrorCode } from './instagram-error-code.enum';

describe('toInstagramError', () => {
  it('같은 코드의 인스타 예외면 그 예외를 돌려준다', () => {
    const error = new InstagramException({
      code: InstagramErrorCode.TOKEN_INVALID,
      message: '무효',
    });
    expect(
      toInstagramError({ error, code: InstagramErrorCode.TOKEN_INVALID }),
    ).toBe(error);
  });

  it('코드가 다르거나 인스타 예외가 아니면 null 을 돌려준다', () => {
    const error = new InstagramException({
      code: InstagramErrorCode.QUOTA_EXCEEDED,
      message: '한도',
    });
    expect(
      toInstagramError({ error, code: InstagramErrorCode.TOKEN_INVALID }),
    ).toBeNull();
    expect(
      toInstagramError({
        error: new Error('x'),
        code: InstagramErrorCode.TOKEN_INVALID,
      }),
    ).toBeNull();
  });
});
