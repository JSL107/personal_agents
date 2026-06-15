import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CareerMateErrorCode } from './career-mate-error-code.enum';

type CareerMateExceptionOptions = {
  message: string;
  code: CareerMateErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class CareerMateException extends DomainException {
  readonly careerMateErrorCode: CareerMateErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.careerMateErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: CareerMateExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.careerMateErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
