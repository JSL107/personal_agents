import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../../../common/exception/domain.exception';
import { WorkReviewerErrorCode } from './work-reviewer-error-code.enum';

type WorkReviewerExceptionOptions = {
  message: string;
  code: WorkReviewerErrorCode;
  status?: HttpStatus;
  cause?: unknown;
};

export class WorkReviewerException extends DomainException {
  readonly workReviewerErrorCode: WorkReviewerErrorCode;
  readonly cause: unknown;
  readonly httpStatus: number;

  get errorCode(): string {
    return this.workReviewerErrorCode;
  }

  constructor({
    message,
    code,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    cause,
  }: WorkReviewerExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.workReviewerErrorCode = code;
    this.httpStatus = status;
    this.cause = cause;
  }
}
