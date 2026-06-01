// CLAUDE.md §6 / 2026-05-30 사고와 같이 claude CLI 가 인증 만료 / 쿼터 소진으로 침묵 실패
// (exit=1 + 빈 stderr 또는 인증 키워드 stderr) 한 사건을 owner 에게 즉시 알리기 위한 port.
//
// ModelRouterUsecase 가 ClaudeAuthSuspectException 을 catch 한 시점에서 호출.
// 구현체는 SlackClaudeAuthAlerter (env 설정 시 Slack DM) / NoopClaudeAuthAlerter (env 미설정 시).
// 30분 dedupe 는 구현체 책임 — fallback chain 이 짧은 시간 안 여러 번 같은 실패를 반복할 수 있다.
export interface ClaudeAuthAlertPort {
  notifyAuthSuspect(payload: { exitMessage: string }): Promise<void>;
}

export const CLAUDE_AUTH_ALERT_PORT = Symbol('CLAUDE_AUTH_ALERT_PORT');
