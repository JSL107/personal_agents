import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { AppException } from '../exception/app.exception';
import { DomainException } from '../exception/domain.exception';
import { DomainStatus } from '../exception/domain-status.enum';
import { ResponseCode } from '../exception/response-code.enum';
import { ApiResponse } from '../response/api-response.type';

const DOMAIN_TO_HTTP_STATUS: Readonly<Record<DomainStatus, HttpStatus>> = {
  [DomainStatus.BAD_REQUEST]: HttpStatus.BAD_REQUEST,
  [DomainStatus.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
  [DomainStatus.FORBIDDEN]: HttpStatus.FORBIDDEN,
  [DomainStatus.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [DomainStatus.CONFLICT]: HttpStatus.CONFLICT,
  [DomainStatus.PRECONDITION_FAILED]: HttpStatus.PRECONDITION_FAILED,
  [DomainStatus.UNPROCESSABLE_ENTITY]: HttpStatus.UNPROCESSABLE_ENTITY,
  [DomainStatus.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
  [DomainStatus.BAD_GATEWAY]: HttpStatus.BAD_GATEWAY,
  [DomainStatus.SERVICE_UNAVAILABLE]: HttpStatus.SERVICE_UNAVAILABLE,
  [DomainStatus.GATEWAY_TIMEOUT]: HttpStatus.GATEWAY_TIMEOUT,
};

/// 4xx 로그에 요청자를 남긴다. UA 는 신뢰 경계 밖 입력이므로 개행을 지워 로그 위조를 막고
/// 길이를 잘라 한 줄을 유지한다.
function resolveUserAgent(request: Request): string {
  const raw = request.headers['user-agent'];
  if (raw === undefined) {
    return '-';
  }
  return raw.replace(/[\r\n]+/g, ' ').slice(0, 80);
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const status = this.resolveStatus(exception);
    const code = this.resolveCode(exception);
    const message = this.resolveMessage(exception);

    if (exception instanceof Error) {
      const isServerError = status >= HttpStatus.INTERNAL_SERVER_ERROR;
      if (isServerError) {
        this.logger.error(
          `[${request.method}] ${request.url}`,
          exception.stack,
        );
      } else {
        this.logger.warn(
          `[${request.method}] ${request.url} ${status} ${message} ua=${resolveUserAgent(request)}`,
        );
      }
    }

    const body: ApiResponse<null> = { code, message, data: null };
    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    if (exception instanceof DomainException) {
      return DOMAIN_TO_HTTP_STATUS[exception.status];
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveCode(exception: unknown): ResponseCode {
    if (exception instanceof AppException) {
      return exception.responseCode;
    }
    if (exception instanceof DomainException) {
      const code = Object.values(ResponseCode).find(
        (value) => value === exception.errorCode,
      );
      return code ?? ResponseCode.INTERNAL_SERVER_ERROR;
    }
    if (exception instanceof HttpException) {
      return ResponseCode.INTERNAL_SERVER_ERROR;
    }
    return ResponseCode.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      return exception.message;
    }
    if (exception instanceof DomainException) {
      return exception.message;
    }
    return '서버 오류가 발생했습니다.';
  }
}
