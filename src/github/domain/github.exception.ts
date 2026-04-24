import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { GithubErrorCode } from './github-error-code.enum';

type GithubExceptionOptions = {
  message: string;
  code: GithubErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class GithubException extends DomainException {
  readonly githubErrorCode: GithubErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.githubErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.BAD_GATEWAY,
    cause,
  }: GithubExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.githubErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
