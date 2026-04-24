import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PmAgentErrorCode } from './pm-agent-error-code.enum';

type PmAgentExceptionOptions = {
  message: string;
  code: PmAgentErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class PmAgentException extends DomainException {
  readonly pmAgentErrorCode: PmAgentErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.pmAgentErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: PmAgentExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.pmAgentErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
