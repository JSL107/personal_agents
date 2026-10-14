import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { IdeaTriageErrorCode } from './idea-triage-error-code.enum';

export class IdeaTriageException extends DomainException {
  readonly errorCode = IdeaTriageErrorCode.INVALID_MODEL_OUTPUT;
  readonly status = DomainStatus.BAD_GATEWAY;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
