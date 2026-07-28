// 로컬에서 실행 중인 CLI 세션 한 건(도메인 표현). 콘솔 뷰 타입으로는 console-mappers 에서 변환.
export type LocalSessionSource = 'claude' | 'codex';
export type LocalSessionState = 'active' | 'idle';

export interface LocalSession {
  readonly sessionId: string;
  readonly pid: number;
  readonly source: LocalSessionSource;
  readonly name: string;
  readonly cwd: string;
  readonly state: LocalSessionState;
  readonly startedAt: Date;
  readonly lastActivityAt: Date | null;
}
