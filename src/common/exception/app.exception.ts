import { HttpException, HttpStatus } from '@nestjs/common';

import { ResponseCode } from './response-code.enum';

export class AppException extends HttpException {
  readonly responseCode: ResponseCode;

  constructor({
    code,
    message,
    status = HttpStatus.INTERNAL_SERVER_ERROR,
  }: {
    code: ResponseCode;
    message: string;
    status?: HttpStatus;
  }) {
    super({ code, message }, status);
    this.responseCode = code;
  }
}
