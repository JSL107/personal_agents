import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeTestErrorCode } from './be-test-error-code.enum';

type BeTestExceptionOptions = {
  message: string;
  code: BeTestErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class BeTestException extends DomainException {
  readonly beTestErrorCode: BeTestErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.beTestErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BeTestExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.beTestErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
