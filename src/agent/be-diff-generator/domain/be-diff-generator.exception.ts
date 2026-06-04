import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeDiffGeneratorErrorCode } from './be-diff-generator-error-code.enum';

type BeDiffGeneratorExceptionOptions = {
  message: string;
  code: BeDiffGeneratorErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class BeDiffGeneratorException extends DomainException {
  readonly beDiffGeneratorErrorCode: BeDiffGeneratorErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.beDiffGeneratorErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BeDiffGeneratorExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.beDiffGeneratorErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
