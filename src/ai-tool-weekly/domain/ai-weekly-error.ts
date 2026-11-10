export type AiWeeklyErrorCode =
  | 'BAD_ARGS'
  | 'INTERNAL'
  | 'TIMEOUT'
  | 'OUTPUT_TOO_LARGE'
  | 'BAD_JSON'
  | 'SHAPE'
  | 'SCRIPT_MISSING'
  | 'SPAWN_FAILED'
  | 'UNKNOWN';

export const AI_WEEKLY_ERROR_CODES: readonly AiWeeklyErrorCode[] = [
  'BAD_ARGS',
  'INTERNAL',
  'TIMEOUT',
  'OUTPUT_TOO_LARGE',
  'BAD_JSON',
  'SHAPE',
  'SCRIPT_MISSING',
  'SPAWN_FAILED',
  'UNKNOWN',
];

export class AiWeeklyError extends Error {
  readonly code: AiWeeklyErrorCode;
  readonly exitCode: number | null;

  constructor({
    code,
    exitCode,
  }: {
    code: AiWeeklyErrorCode;
    exitCode: number | null;
  }) {
    super(`exit=${exitCode ?? 'none'} code=${code}`);
    this.name = 'AiWeeklyError';
    this.code = code;
    this.exitCode = exitCode;
  }
}
