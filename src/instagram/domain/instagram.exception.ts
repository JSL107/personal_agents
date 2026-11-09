import { DomainException } from '../../common/exception/domain.exception';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import { InstagramErrorCode } from './instagram-error-code.enum';

type InstagramExceptionOptions = {
  message: string;
  code: InstagramErrorCode;
  status?: DomainStatus;
  cause?: unknown;
};

export class InstagramException extends DomainException {
  readonly instagramErrorCode: InstagramErrorCode;
  readonly status: DomainStatus;
  readonly cause: unknown;

  get errorCode(): string {
    return this.instagramErrorCode;
  }

  constructor({
    message,
    code,
    status = DomainStatus.INTERNAL,
    cause,
  }: InstagramExceptionOptions) {
    super(message);
    this.name = new.target.name;
    this.instagramErrorCode = code;
    this.status = status;
    this.cause = cause;
  }
}

export class ReelFormatLedgerCorruptedException extends InstagramException {
  constructor(readonly ids: string[]) {
    super({
      message: `릴스 형식 판정 원장 행이 손상됐습니다: ${ids.join(', ')}`,
      code: InstagramErrorCode.REEL_FORMAT_LEDGER_CORRUPTED,
    });
  }
}

// 오류가 그 코드의 InstagramException 이면 좁혀진 예외를, 아니면 null 을 돌려준다.
// boolean 이 아니라 예외를 돌려주는 이유: 호출부가 메시지·코드를 읽을 때 instanceof 를 한 번 더 쓰지 않게.
export const toInstagramError = ({
  error,
  code,
}: {
  error: unknown;
  code: InstagramErrorCode;
}): InstagramException | null => {
  if (!(error instanceof InstagramException)) {
    return null;
  }
  return error.instagramErrorCode === code ? error : null;
};
