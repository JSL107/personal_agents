import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { JobApplicationErrorCode } from './job-application-error-code.enum';

type JobApplicationExceptionOptions = {
  message: string;
  code: JobApplicationErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class JobApplicationException extends DomainException {
  readonly jobApplicationErrorCode: JobApplicationErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.jobApplicationErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: JobApplicationExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.jobApplicationErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
