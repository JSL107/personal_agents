import { ACTIVE_WINDOW_MS, deriveSessionState } from './session-activity';

describe('deriveSessionState', () => {
  const now = new Date('2026-07-27T10:00:00.000Z');

  it('transcript 가 없으면 항상 idle', () => {
    expect(
      deriveSessionState({ hasTranscript: false, lastActivityAt: null, now }),
    ).toBe('idle');
  });

  it('마지막 활동이 60초 이내면 active', () => {
    const lastActivityAt = new Date(now.getTime() - (ACTIVE_WINDOW_MS - 1));
    expect(
      deriveSessionState({ hasTranscript: true, lastActivityAt, now }),
    ).toBe('active');
  });

  it('마지막 활동이 60초 이상 지났으면 idle', () => {
    const lastActivityAt = new Date(now.getTime() - ACTIVE_WINDOW_MS);
    expect(
      deriveSessionState({ hasTranscript: true, lastActivityAt, now }),
    ).toBe('idle');
  });
});
