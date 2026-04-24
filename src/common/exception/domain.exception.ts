import { DomainStatus } from './domain-status.enum';

// 도메인/애플리케이션 레이어가 throw 하는 예외의 base class.
// NestJS / HTTP 의존성을 가지지 않는다 — `status` 는 framework-agnostic DomainStatus.
// HTTP 변환은 AllExceptionsFilter 가 담당.
export abstract class DomainException extends Error {
  abstract readonly errorCode: string;
  abstract readonly status: DomainStatus;
}
