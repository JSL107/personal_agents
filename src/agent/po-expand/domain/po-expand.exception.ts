import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PoExpandErrorCode } from './po-expand-error-code.enum';

type PoExpandExceptionOptions = {
  message: string;
  code: PoExpandErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class PoExpandException extends DomainException {
  readonly poExpandErrorCode: PoExpandErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.poExpandErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: PoExpandExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.poExpandErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
