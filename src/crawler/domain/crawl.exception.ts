import { HttpStatus } from '@nestjs/common';

import { DomainException } from '../../common/exception/domain.exception';
import { CrawlErrorCode } from './crawl-error-code.enum';

type CrawlExceptionOptions = {
  message: string;
  code: CrawlErrorCode;
  status?: HttpStatus;
  cause?: unknown;
};

export class CrawlException extends DomainException {
  readonly crawlErrorCode: CrawlErrorCode;
  readonly cause: unknown;
  readonly httpStatus: number;

  get errorCode(): string {
    return this.crawlErrorCode;
  }

  constructor({ message, code, status, cause }: CrawlExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.crawlErrorCode = code;
    this.httpStatus = status ?? HttpStatus.INTERNAL_SERVER_ERROR;
    this.cause = cause;
  }
}

export class CrawlTransientException extends CrawlException {
  constructor({
    message,
    code = CrawlErrorCode.TARGET_UNAVAILABLE,
    status = HttpStatus.SERVICE_UNAVAILABLE,
    cause,
  }: {
    message: string;
    code?: CrawlErrorCode;
    status?: HttpStatus;
    cause?: unknown;
  }) {
    super({ message, code, status, cause });
  }
}

export class CrawlPermanentException extends CrawlException {
  constructor({
    message,
    code = CrawlErrorCode.FAILED,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
    cause,
  }: {
    message: string;
    code?: CrawlErrorCode;
    status?: HttpStatus;
    cause?: unknown;
  }) {
    super({ message, code, status, cause });
  }
}
