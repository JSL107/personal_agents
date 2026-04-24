import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { SlackCollectorErrorCode } from './slack-collector-error-code.enum';

type SlackCollectorExceptionOptions = {
  message: string;
  code: SlackCollectorErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class SlackCollectorException extends DomainException {
  readonly slackCollectorErrorCode: SlackCollectorErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.slackCollectorErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.BAD_GATEWAY,
    cause,
  }: SlackCollectorExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.slackCollectorErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
