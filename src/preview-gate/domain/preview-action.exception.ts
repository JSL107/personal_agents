import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { PreviewActionErrorCode } from './preview-action-error-code.enum';

type PreviewActionExceptionOptions = {
  message: string;
  code: PreviewActionErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class PreviewActionException extends DomainException {
  readonly previewActionErrorCode: PreviewActionErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.previewActionErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: PreviewActionExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.previewActionErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
