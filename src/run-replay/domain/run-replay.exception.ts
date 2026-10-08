import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { ReplayRejection, ReplayRejectionCode } from './run-replay.type';

const REJECTION_STATUS: Readonly<Record<ReplayRejectionCode, DomainStatus>> = {
  [ReplayRejectionCode.NOT_FOUND]: DomainStatus.NOT_FOUND,
  [ReplayRejectionCode.INVALID_SNAPSHOT]: DomainStatus.UNPROCESSABLE_ENTITY,
  [ReplayRejectionCode.FORBIDDEN]: DomainStatus.FORBIDDEN,
  [ReplayRejectionCode.NOT_SUPPORTED]: DomainStatus.UNPROCESSABLE_ENTITY,
  [ReplayRejectionCode.NOT_REPRODUCIBLE]: DomainStatus.CONFLICT,
  [ReplayRejectionCode.UNKNOWN_AGENT_TYPE]: DomainStatus.UNPROCESSABLE_ENTITY,
  [ReplayRejectionCode.IN_FLIGHT]: DomainStatus.CONFLICT,
};

// 콘솔 경로가 거절을 HTTP 4xx 로 내보낼 때 쓴다. 문구는 Slack 이 보여 주는 것과 같다.
export class RunReplayException extends DomainException {
  readonly errorCode: ReplayRejectionCode;
  readonly status: DomainStatus;

  constructor(rejection: Pick<ReplayRejection, 'code' | 'message'>) {
    super(rejection.message);
    this.name = new.target.name;
    this.errorCode = rejection.code;
    this.status = REJECTION_STATUS[rejection.code];
  }
}
