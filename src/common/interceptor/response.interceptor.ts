import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

import { ResponseCode } from '../exception/response-code.enum';
import { ApiResponse } from '../response/api-response.type';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: ResponseCode.SUCCESS,
        message: '요청이 성공적으로 처리되었습니다.',
        data: data ?? null,
      })),
    );
  }
}
