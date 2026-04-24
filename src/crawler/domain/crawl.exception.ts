import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { CrawlErrorCode } from './crawl-error-code.enum';

type CrawlExceptionOptions = {
  message: string;
  code: CrawlErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class CrawlException extends DomainException {
  readonly crawlErrorCode: CrawlErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.crawlErrorCode;
  }

  constructor({ message, code, status, cause }: CrawlExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.crawlErrorCode = code;
    this.status = status ?? DomainStatus.INTERNAL;
    this.cause = cause;
  }
}

export class CrawlTransientException extends CrawlException {
  constructor({
    message,
    code = CrawlErrorCode.TARGET_UNAVAILABLE,
    status = DomainStatus.SERVICE_UNAVAILABLE,
    cause,
  }: {
    message: string;
    code?: CrawlErrorCode;
    status?: DomainStatus;
    cause?: unknown;
  }) {
    super({ message, code, status, cause });
  }
}

export class CrawlPermanentException extends CrawlException {
  constructor({
    message,
    code = CrawlErrorCode.FAILED,
    status = DomainStatus.INTERNAL,
    cause,
  }: {
    message: string;
    code?: CrawlErrorCode;
    status?: DomainStatus;
    cause?: unknown;
  }) {
    super({ message, code, status, cause });
  }
}
