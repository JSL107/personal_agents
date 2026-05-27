import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { RouterErrorCode } from './router-error-code.enum';

type RouterExceptionOptions = {
  message: string;
  code: RouterErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class RouterException extends DomainException {
  readonly routerErrorCode: RouterErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.routerErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: RouterExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.routerErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
