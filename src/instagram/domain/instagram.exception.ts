import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { InstagramErrorCode } from './instagram-error-code.enum';

type InstagramExceptionOptions = {
  message: string;
  code: InstagramErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class InstagramException extends DomainException {
  readonly instagramErrorCode: InstagramErrorCode;
  readonly status: DomainStatus;
  readonly cause: unknown;

  get errorCode(): string {
    return this.instagramErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: InstagramExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.instagramErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
