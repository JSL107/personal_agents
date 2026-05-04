import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeSreErrorCode } from './be-sre-error-code.enum';

type BeSreExceptionOptions = {
  message: string;
  code: BeSreErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class BeSreException extends DomainException {
  readonly beSreErrorCode: BeSreErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.beSreErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BeSreExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.beSreErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
