import { buildStopDecision } from './stop-decision';

describe('buildStopDecision', () => {
  it('지시가 있으면 decision:block JSON 반환', () => {
    const out = buildStopDecision(
      JSON.stringify({ session_id: 's1' }),
      4242,
      (pid, sessionId) =>
        pid === 4242 && sessionId === 's1' ? '고쳐줘' : null,
    );
    expect(JSON.parse(out)).toEqual({ decision: 'block', reason: '고쳐줘' });
  });

  it('지시가 없으면 빈 문자열(정상 종료 허용)', () => {
    const out = buildStopDecision(
      JSON.stringify({ session_id: 's1' }),
      4242,
      () => null,
    );
    expect(out).toBe('');
  });

  it('payload 없음/빈 값이면 빈 문자열', () => {
    expect(buildStopDecision(null, 4242, () => 'x')).toBe('');
    expect(buildStopDecision('   ', 4242, () => 'x')).toBe('');
  });

  it('session_id 없으면 빈 문자열', () => {
    expect(buildStopDecision(JSON.stringify({}), 4242, () => 'x')).toBe('');
  });

  it('잘못된 ppid 면 빈 문자열', () => {
    expect(
      buildStopDecision(JSON.stringify({ session_id: 's1' }), 0, () => 'x'),
    ).toBe('');
  });

  it('consume 가 throw 해도 빈 문자열(세션을 멈추지 않는다)', () => {
    const out = buildStopDecision(
      JSON.stringify({ session_id: 's1' }),
      4242,
      () => {
        throw new Error('boom');
      },
    );
    expect(out).toBe('');
  });

  it('깨진 JSON payload 면 빈 문자열', () => {
    expect(buildStopDecision('{not json', 4242, () => 'x')).toBe('');
  });
});
