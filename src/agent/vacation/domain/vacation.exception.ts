import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { VacationErrorCode } from './vacation-error-code.enum';

type VacationExceptionOptions = {
  message: string;
  code: VacationErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class VacationException extends DomainException {
  readonly vacationErrorCode: VacationErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.vacationErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: VacationExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.vacationErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
