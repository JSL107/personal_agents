import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BlogErrorCode } from './blog-error-code.enum';

type BlogExceptionOptions = {
  message: string;
  code: BlogErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

// WorkReviewerException 과 동일 패턴 — DomainException(message) 상속 + errorCode getter.
export class BlogException extends DomainException {
  readonly blogErrorCode: BlogErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.blogErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BlogExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.blogErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
