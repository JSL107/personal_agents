import { ResponseCode } from '../exception/response-code.enum';

export type ApiResponse<T> = {
  code: ResponseCode;
  message: string;
  data: T | null;
  meta?: {
    requestId?: string;
  };
};
