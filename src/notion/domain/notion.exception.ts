import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { NotionErrorCode } from './notion-error-code.enum';

type NotionExceptionOptions = {
  message: string;
  code: NotionErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class NotionException extends DomainException {
  readonly notionErrorCode: NotionErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.notionErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.BAD_GATEWAY,
    cause,
  }: NotionExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.notionErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
