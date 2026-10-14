import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { RouterErrorCode } from './router-error-code.enum';

type RouterExceptionOptions = {
  message: string;
  code: RouterErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class RouterException extends DomainException {
  readonly routerErrorCode: RouterErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;
  // 담당을 못 고른 회차를 라우터가 원장(ROUTER)에 남겼으면 그 run id. 대화 답변이 만든 답을
  // 같은 행에 붙여 "그때 뭐라고 답했나" 를 나중에 볼 수 있게 한다. 기록 실패면 비어 있다.
  routingMissRunId?: number;

  get errorCode(): string {
    return this.routerErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: RouterExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.routerErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
