import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ScheduleErrorCode } from './schedule-error-code.enum';

type ScheduleExceptionOptions = {
  message: string;
  code: ScheduleErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class ScheduleException extends DomainException {
  readonly scheduleErrorCode: ScheduleErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.scheduleErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: ScheduleExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.scheduleErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
