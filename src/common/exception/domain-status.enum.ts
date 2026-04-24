// 도메인 레이어가 NestJS HttpStatus 에 직접 의존하지 않도록 하기 위한 framework-agnostic status 열거.
// AllExceptionsFilter 가 HTTP 응답 변환 시점에 domainStatusToHttpStatus() 로 매핑.
// HTTP semantic 과 1:1 대응되지만 enum 값은 의미 기반 string — 도메인 코드가 numeric HTTP code 를 몰라도 됨.
export enum DomainStatus {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  PRECONDITION_FAILED = 'PRECONDITION_FAILED',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  INTERNAL = 'INTERNAL',
  BAD_GATEWAY = 'BAD_GATEWAY',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT = 'GATEWAY_TIMEOUT',
}
