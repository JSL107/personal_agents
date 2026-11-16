import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { StrategyParameterErrorCode } from './strategy-parameter-error-code.enum';

/**
 * 네 축 중 활성 행이 빠진 상태. 코드 상수로 메우지 않는다 — 조정 경로가 "있는 척" 한 값 위에서
 * 새 버전을 쌓으면 어떤 값이 바뀐 것인지 귀속할 수 없다.
 */
export class StrategyParameterSnapshotError extends DomainException {
  readonly errorCode = StrategyParameterErrorCode.SNAPSHOT_INCOMPLETE;
  readonly status = DomainStatus.INTERNAL;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
