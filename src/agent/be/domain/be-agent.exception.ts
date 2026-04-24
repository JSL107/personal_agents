import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeAgentErrorCode } from './be-agent-error-code.enum';

type BeAgentExceptionOptions = {
  message: string;
  code: BeAgentErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class BeAgentException extends DomainException {
  readonly beAgentErrorCode: BeAgentErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.beAgentErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BeAgentExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.beAgentErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
