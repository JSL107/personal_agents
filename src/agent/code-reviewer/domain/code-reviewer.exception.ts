import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../../../common/exception/domain.exception';
import { CodeReviewerErrorCode } from './code-reviewer-error-code.enum';

type CodeReviewerExceptionOptions = {
  message: string;
  code: CodeReviewerErrorCode;
  status?: HttpStatus;
  cause?: unknown;
};

export class CodeReviewerException extends DomainException {
  readonly codeReviewerErrorCode: CodeReviewerErrorCode;
  readonly cause: unknown;
  readonly httpStatus: number;

  get errorCode(): string {
    return this.codeReviewerErrorCode;
  }

  constructor({
    message,
    code,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    cause,
  }: CodeReviewerExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.codeReviewerErrorCode = code;
    this.httpStatus = status;
    this.cause = cause;
  }
}
