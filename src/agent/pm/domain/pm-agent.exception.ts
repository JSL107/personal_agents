import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../../../common/exception/domain.exception';
import { PmAgentErrorCode } from './pm-agent-error-code.enum';

type PmAgentExceptionOptions = {
  message: string;
  code: PmAgentErrorCode;
  status?: HttpStatus;
  cause?: unknown;
};

export class PmAgentException extends DomainException {
  readonly pmAgentErrorCode: PmAgentErrorCode;
  readonly cause: unknown;
  readonly httpStatus: number;

  get errorCode(): string {
    return this.pmAgentErrorCode;
  }

  constructor({
    message,
    code,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    cause,
  }: PmAgentExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.pmAgentErrorCode = code;
    this.httpStatus = status;
    this.cause = cause;
  }
}
