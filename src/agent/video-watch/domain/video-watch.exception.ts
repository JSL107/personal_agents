import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { VideoWatchErrorCode } from './video-watch-error-code.enum';

type VideoWatchExceptionOptions = {
  code: VideoWatchErrorCode;
  message: string;
  status?: DomainStatus;
  cause?: unknown;
};

export class VideoWatchException extends DomainException {
  readonly videoWatchErrorCode: VideoWatchErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.videoWatchErrorCode;
  }

  constructor({
    code,
    message,
    status = DomainStatus.INTERNAL,
    cause,
  }: VideoWatchExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.videoWatchErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
