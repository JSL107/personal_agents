import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BeSchemaErrorCode } from './be-schema-error-code.enum';

type BeSchemaExceptionOptions = {
  message: string;
  code: BeSchemaErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class BeSchemaException extends DomainException {
  readonly beSchemaErrorCode: BeSchemaErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.beSchemaErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: BeSchemaExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.beSchemaErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
