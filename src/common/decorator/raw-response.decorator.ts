import { SetMetadata } from '@nestjs/common';

// ResponseInterceptor 의 {code,message,data} 래핑을 건너뛰라는 표식.
// SSE(@Sse) 스트림처럼 응답 본문을 가공하면 안 되는 핸들러에 붙인다.
export const RAW_RESPONSE_KEY = 'raw_response';

export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
