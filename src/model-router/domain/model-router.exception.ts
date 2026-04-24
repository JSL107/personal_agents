import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ModelRouterErrorCode } from './model-router-error-code.enum';

type ModelRouterExceptionOptions = {
  message: string;
  code: ModelRouterErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class ModelRouterException extends DomainException {
  readonly modelRouterErrorCode: ModelRouterErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.modelRouterErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: ModelRouterExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.modelRouterErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
