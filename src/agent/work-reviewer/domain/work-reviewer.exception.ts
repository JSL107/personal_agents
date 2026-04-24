import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { WorkReviewerErrorCode } from './work-reviewer-error-code.enum';

type WorkReviewerExceptionOptions = {
  message: string;
  code: WorkReviewerErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class WorkReviewerException extends DomainException {
  readonly workReviewerErrorCode: WorkReviewerErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.workReviewerErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: WorkReviewerExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.workReviewerErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
