import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PoEvalErrorCode } from './po-eval-error-code.enum';

type PoEvalExceptionOptions = {
  message: string;
  code: PoEvalErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class PoEvalException extends DomainException {
  readonly poEvalErrorCode: PoEvalErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.poEvalErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: PoEvalExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.poEvalErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
