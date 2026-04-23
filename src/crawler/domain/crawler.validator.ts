import { HttpStatus } from '@nestjs/common';

import {
  CrawlPermanentException,
  CrawlTransientException,
} from './crawl.exception';
import { CrawlErrorCode } from './crawl-error-code.enum';

export const validateCrawlUrl = ({ url }: { url: string }): void => {
  try {
    const parsedUrl = new URL(url);
    const isHttp = parsedUrl.protocol === 'http:';
    const isHttps = parsedUrl.protocol === 'https:';

    if (!isHttp && !isHttps) {
      throw new CrawlPermanentException({
        code: CrawlErrorCode.INVALID_URL,
        message: `지원하지 않는 URL 프로토콜입니다: ${url}`,
        status: HttpStatus.BAD_REQUEST,
      });
    }
  } catch (error: unknown) {
    if (error instanceof CrawlPermanentException) {
      throw error;
    }

    throw new CrawlPermanentException({
      code: CrawlErrorCode.INVALID_URL,
      message: `유효하지 않은 크롤링 URL입니다: ${url}`,
      status: HttpStatus.BAD_REQUEST,
      cause: error,
    });
  }
};

export const validateCrawlResponse = ({
  responseStatus,
  url,
}: {
  responseStatus: number | null;
  url: string;
}): void => {
  if (responseStatus === null) {
    throw new CrawlTransientException({
      message: `크롤링 응답을 받지 못했습니다: ${url}`,
    });
  }

  if (responseStatus === 429 || responseStatus >= 500) {
    throw new CrawlTransientException({
      message: `일시적인 크롤링 대상 오류가 발생했습니다. (${responseStatus}) ${url}`,
    });
  }

  if (responseStatus >= 400) {
    const code =
      responseStatus === 404
        ? CrawlErrorCode.TARGET_NOT_FOUND
        : CrawlErrorCode.FAILED;

    throw new CrawlPermanentException({
      code,
      message: `복구 불가능한 크롤링 대상 오류가 발생했습니다. (${responseStatus}) ${url}`,
      status:
        responseStatus === 404 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY,
    });
  }
};
