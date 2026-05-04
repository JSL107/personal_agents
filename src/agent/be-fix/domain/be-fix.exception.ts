import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeFixErrorCode } from './be-fix-error-code.enum';

type BeFixExceptionOptions = {
  message: string;
  code: BeFixErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class BeFixException extends DomainException {
  readonly beFixErrorCode: BeFixErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.beFixErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BeFixExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.beFixErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
