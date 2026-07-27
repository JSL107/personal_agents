import { ConsoleEvent, ConsoleSession } from '../domain/console.type';

// 표시에 영향을 주는 가변 필드만 비교(재발행 최소화).
function sessionChanged(
  before: ConsoleSession,
  after: ConsoleSession,
): boolean {
  return (
    before.state !== after.state ||
    before.lastActivityAt !== after.lastActivityAt
  );
}

export function diffSessions(
  previous: ConsoleSession[],
  next: ConsoleSession[],
): ConsoleEvent[] {
  const events: ConsoleEvent[] = [];
  const previousById = new Map(
    previous.map((session) => [session.sessionId, session]),
  );
  const nextById = new Map(next.map((session) => [session.sessionId, session]));

  for (const session of next) {
    const before = previousById.get(session.sessionId);
    if (before === undefined) {
      events.push({ type: 'session.opened', session });
    } else if (sessionChanged(before, session)) {
      events.push({ type: 'session.updated', session });
    }
  }
  for (const session of previous) {
    if (!nextById.has(session.sessionId)) {
      events.push({ type: 'session.closed', sessionId: session.sessionId });
    }
  }
  return events;
}
