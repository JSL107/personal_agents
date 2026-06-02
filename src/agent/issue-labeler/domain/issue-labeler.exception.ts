import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { IssueLabelerErrorCode } from './issue-labeler-error-code.enum';

type IssueLabelerExceptionOptions = {
  message: string;
  code: IssueLabelerErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class IssueLabelerException extends DomainException {
  readonly issueLabelerErrorCode: IssueLabelerErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.issueLabelerErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: IssueLabelerExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.issueLabelerErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
