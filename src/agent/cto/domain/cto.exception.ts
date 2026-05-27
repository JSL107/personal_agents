import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CtoErrorCode } from './cto-error-code.enum';

type CtoExceptionOptions = {
  message: string;
  code: CtoErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class CtoException extends DomainException {
  readonly ctoErrorCode: CtoErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.ctoErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: CtoExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.ctoErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
