import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CeoErrorCode } from './ceo-error-code.enum';

type CeoExceptionOptions = {
  message: string;
  code: CeoErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class CeoException extends DomainException {
  readonly ceoErrorCode: CeoErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.ceoErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: CeoExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.ceoErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
