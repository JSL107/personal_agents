import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../../common/exception/domain.exception';
import { ModelRouterErrorCode } from './model-router-error-code.enum';

type ModelRouterExceptionOptions = {
  message: string;
  code: ModelRouterErrorCode;
  status?: HttpStatus;
  cause?: unknown;
};

export class ModelRouterException extends DomainException {
  readonly modelRouterErrorCode: ModelRouterErrorCode;
  readonly cause: unknown;
  readonly httpStatus: number;

  get errorCode(): string {
    return this.modelRouterErrorCode;
  }

  constructor({
    message,
    code,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    cause,
  }: ModelRouterExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.modelRouterErrorCode = code;
    this.httpStatus = status;
    this.cause = cause;
  }
}
