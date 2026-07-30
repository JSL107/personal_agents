// Stop 훅 결정 로직(순수). payload 에서 session_id 를 뽑아 consume 하고, 전달할 지시가
// 있으면 decision:block JSON 을, 없으면(또는 어떤 오류든) 빈 문자열을 반환한다.
// 빈 문자열 = 정상 종료 허용. 우리 버그로 세션을 멈추지 않기 위해 전 구간 try/catch.
export function buildStopDecision(
  payloadRaw: string | null,
  ppid: number,
  consume: (pid: number, sessionId: string) => string | null,
): string {
  try {
    if (payloadRaw === null || payloadRaw.trim().length === 0) {
      return '';
    }
    const payload = JSON.parse(payloadRaw) as { session_id?: unknown };
    const sessionId =
      typeof payload.session_id === 'string' ? payload.session_id : '';
    if (sessionId.length === 0) {
      return '';
    }
    if (!Number.isSafeInteger(ppid) || ppid <= 0) {
      return '';
    }
    const instruction = consume(ppid, sessionId);
    if (instruction === null || instruction.length === 0) {
      return '';
    }
    return JSON.stringify({ decision: 'block', reason: instruction });
  } catch {
    return '';
  }
}
