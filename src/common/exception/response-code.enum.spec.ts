import { BlogErrorCode } from '../../agent/blog/domain/blog-error-code.enum';
import { ResponseCode } from './response-code.enum';

describe('ResponseCode', () => {
  it('BlogErrorCode 전부와 1:1로 동기화된다', () => {
    const responseCodes = new Set(Object.values(ResponseCode));

    for (const blogErrorCode of Object.values(BlogErrorCode)) {
      expect(responseCodes).toContain(blogErrorCode);
    }
  });
});
