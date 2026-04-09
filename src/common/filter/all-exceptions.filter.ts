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
import { ResponseCode } from '../exception/response-code.enum';
import { ApiResponse } from '../response/api-response.type';

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
      this.logger.error(`[${request.method}] ${request.url}`, exception.stack);
    }

    const body: ApiResponse<null> = { code, message, data: null };
    response.status(status).json(body);
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveCode(exception: unknown): ResponseCode {
    if (exception instanceof AppException) {
      return exception.responseCode;
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
    return '서버 오류가 발생했습니다.';
  }
}
