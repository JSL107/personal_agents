// AiWeeklyError 는 DomainException 이 아니라 HTTP 응답(ResponseCode)으로 나가지 않는다.
// 그래서 *error-code.enum.ts 파일 규칙(ResponseCode 동기화 대상) 밖에 둔다.
// 집계 스크립트가 stderr 첫 줄(`AIWM_ERROR <CODE>`)로 내보내는 오류 코드와 러너 자체 실패.
// 목록에 없는 코드는 UNKNOWN 으로 바꿔, 스크립트 출력이 오류 메시지로 새지 않게 한다.
export enum AiWeeklyErrorCode {
  BAD_ARGS = 'BAD_ARGS',
  INTERNAL = 'INTERNAL',
  TIMEOUT = 'TIMEOUT',
  OUTPUT_TOO_LARGE = 'OUTPUT_TOO_LARGE',
  BAD_JSON = 'BAD_JSON',
  SHAPE = 'SHAPE',
  SCRIPT_MISSING = 'SCRIPT_MISSING',
  SPAWN_FAILED = 'SPAWN_FAILED',
  UNKNOWN = 'UNKNOWN',
}

export const isAiWeeklyErrorCode = (
  value: string,
): value is AiWeeklyErrorCode =>
  Object.values<string>(AiWeeklyErrorCode).includes(value);

export interface AiWeeklyErrorInput {
  code: AiWeeklyErrorCode;
  exitCode: number | null;
}

export class AiWeeklyError extends Error {
  readonly code: AiWeeklyErrorCode;
  readonly exitCode: number | null;

  constructor({ code, exitCode }: AiWeeklyErrorInput) {
    super(`exit=${exitCode ?? 'none'} code=${code}`);
    this.name = 'AiWeeklyError';
    this.code = code;
    this.exitCode = exitCode;
  }
}
