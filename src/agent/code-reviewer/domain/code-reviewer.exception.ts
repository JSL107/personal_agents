import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { CodeReviewerErrorCode } from './code-reviewer-error-code.enum';

type CodeReviewerExceptionOptions = {
  message: string;
  code: CodeReviewerErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class CodeReviewerException extends DomainException {
  readonly codeReviewerErrorCode: CodeReviewerErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.codeReviewerErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: CodeReviewerExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.codeReviewerErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
