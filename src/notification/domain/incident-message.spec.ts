import {
  describeIncidentCause,
  formatAiHandoff,
  formatIncidentOpen,
  formatIncidentRemind,
  formatIncidentResolved,
} from './incident-message';

describe('incident messages', () => {
  it('본문은 짧은 설명만 싣고 원문을 싣지 않는다', () => {
    expect(
      formatIncidentOpen({
        label: '포트폴리오 사이트 발행',
        cause: '로그인이 만료된 것 같아요',
        nextRunAt: '내일 08:00',
      }),
    ).toBe(
      '🔴 *포트폴리오 사이트 발행이 멈췄어요*\n원인: 로그인이 만료된 것 같아요 (추정)\n지금 상태: 내일 08:00에 다시 시도해요.',
    );
    expect(
      formatIncidentOpen({ label: 'x', cause: null, nextRunAt: null }),
    ).toContain('원인: 확인 중');
  });

  it('재알림과 해결은 일수와 횟수를 설명한다', () => {
    expect(
      formatIncidentRemind({
        label: '발행',
        dayCount: 3,
        occurrences: 5,
        cause: null,
      }),
    ).toContain('3일째');
    expect(
      formatIncidentResolved({
        label: '발행',
        duration: '3시간',
        occurrences: 5,
      }),
    ).toContain('3시간');
  });

  it('AI 블록은 토큰과 URL 자격증명과 password를 가리고 펜스를 깨지 않는다', () => {
    const text = formatAiHandoff({
      feature: 'x',
      errorMessage: 'xoxb-123-abc https://u:p@h/x password=hunter2 ```',
      files: [],
      checkCommand: null,
    });
    expect(text).not.toMatch(/xoxb-123|u:p@|hunter2/);
    expect(text.match(/```/g)).toHaveLength(2);
  });

  it('오류 원인을 고정된 쉬운 말로 분류한다', () => {
    expect(describeIncidentCause('Not logged in · Please run /login')).toBe(
      '로그인이 만료된 것 같아요',
    );
    expect(describeIncidentCause('rate limit')).toBe('사용량 한도에 걸렸어요');
    expect(describeIncidentCause('ETIMEDOUT')).toBe('응답 시간이 초과됐어요');
    expect(describeIncidentCause('ECONNREFUSED')).toBe('연결이 끊겼어요');
    expect(describeIncidentCause('weird')).toBeNull();
  });
});
