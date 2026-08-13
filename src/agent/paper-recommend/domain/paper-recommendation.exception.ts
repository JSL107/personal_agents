import { DomainException } from '../../../common/exception/domain.exception';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { PaperRecommendationErrorCode } from './paper-recommendation-error-code.enum';

type PaperRecommendationExceptionOptions = {
  message: string;
  code: PaperRecommendationErrorCode;
  cause?: unknown;
};

export class PaperRecommendationException extends DomainException {
  readonly paperRecommendationErrorCode: PaperRecommendationErrorCode;
  readonly status = DomainStatus.BAD_GATEWAY;
  readonly cause: unknown;

  get errorCode(): string {
    return this.paperRecommendationErrorCode;
  }

  constructor({ message, code, cause }: PaperRecommendationExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.paperRecommendationErrorCode = code;
    this.cause = cause;
  }
}
