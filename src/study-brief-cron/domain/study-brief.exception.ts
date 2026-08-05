import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { StudyBriefErrorCode } from './study-brief-error-code.enum';

interface StudyBriefExceptionOptions {
  message: string;
  code: StudyBriefErrorCode;
  status?: DomainStatus;
  cause?: unknown;
}

export class StudyBriefException extends DomainException {
  readonly studyBriefErrorCode: StudyBriefErrorCode;
  readonly cause: unknown;
  readonly status: DomainStatus;

  get errorCode(): string {
    return this.studyBriefErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: StudyBriefExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.studyBriefErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}
