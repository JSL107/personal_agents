import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { SandboxErrorCode } from './sandbox-error-code.enum';

type SandboxExceptionOptions = {
  message: string;
  code: SandboxErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class SandboxException extends DomainException {
  readonly sandboxErrorCode: SandboxErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.sandboxErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: SandboxExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.sandboxErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
