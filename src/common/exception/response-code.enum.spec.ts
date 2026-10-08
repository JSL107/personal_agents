import { BlogErrorCode } from '../../agent/blog/domain/blog-error-code.enum';
import { PoShadowErrorCode } from '../../agent/po-shadow/domain/po-shadow-error-code.enum';
import { ResponseCode } from './response-code.enum';

// AllExceptionsFilter 는 도메인 errorCode 를 ResponseCode 값으로 찾는다 — 없으면 INTERNAL_SERVER_ERROR 로
// 떨어져 클라이언트가 거절과 서버 오류를 구분하지 못한다. 여기 올린 enum 만 동기화가 강제된다.
// ponytail: 아직 전수가 아니다(2026-10-08 실측 9개 enum 26건 누락). 정리되면 도메인 enum 을 전부 올린다.
describe('ResponseCode', () => {
  const responseCodes = new Set<string>(Object.values(ResponseCode));

  it.each([
    ['BlogErrorCode', BlogErrorCode],
    ['PoShadowErrorCode', PoShadowErrorCode],
  ])('%s 전부와 1:1로 동기화된다', (_, domainErrorCode) => {
    for (const code of Object.values(domainErrorCode)) {
      expect(responseCodes).toContain(code);
    }
  });
});
