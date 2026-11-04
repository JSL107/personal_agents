import {
  describeIncidentCause,
  formatAiHandoff,
  formatIncidentOpen,
  formatIncidentRemind,
  formatIncidentResolved,
} from './incident-message';

describe('incident messages', () => {
  it('AI 블록의 오류를 1500자로 자르고 Slack 제어 문자를 이스케이프한다', () => {
    const text = formatAiHandoff({
      feature: 'x',
      errorMessage: `${'a'.repeat(1500)}<ignored>&`,
      files: [],
      checkCommand: null,
    });
    expect(text).toContain(`오류: ${'a'.repeat(1500)}`);
    expect(text).not.toContain('ignored');
    expect(
      formatAiHandoff({
        feature: 'x',
        errorMessage: '<!here> & >',
        files: [],
        checkCommand: null,
      }),
    ).toContain('오류: &lt;!here&gt; &amp; &gt;');
  });

  it('사건 제목은 고정된 작업 조사로 쓰고 원인과 조치, 만료 안내를 보인다', () => {
    expect(
      formatIncidentOpen({
        label: 'AI 로그인',
        cause: null,
        nextRunAt: null,
        action: '다시 로그인해 주세요',
        expiredPrevious: true,
      }),
    ).toContain('🔴 *AI 로그인* 작업이 멈췄어요');
    expect(
      formatIncidentOpen({
        label: 'AI 로그인',
        cause: null,
        nextRunAt: null,
        action: '다시 로그인해 주세요',
        expiredPrevious: true,
      }),
    ).toContain('조치: 다시 로그인해 주세요');
    expect(
      formatIncidentOpen({
        label: 'AI 로그인',
        cause: null,
        nextRunAt: null,
        action: '다시 로그인해 주세요',
        expiredPrevious: true,
      }),
    ).toContain('이전 사건은 24시간 재발이 없어 닫았어요 (해결 확인은 아님)');
    expect(
      formatIncidentRemind({
        label: 'AI 로그인',
        dayCount: 2,
        occurrences: 2,
        cause: null,
      }),
    ).toContain('🔁 *AI 로그인* 작업이 아직 멈춰 있어요');
    expect(
      formatIncidentResolved({
        label: 'AI 로그인',
        duration: '3시간',
        occurrences: 2,
        causes: ['401', 'unknown'],
      }),
    ).toContain(
      '✅ *AI 로그인* 작업이 복구됐어요\n원인: 로그인이 만료된 것 같아요',
    );
  });
  it('본문은 짧은 설명만 싣고 원문을 싣지 않는다', () => {
    expect(
      formatIncidentOpen({
        label: '포트폴리오 사이트 발행',
        cause: '로그인이 만료된 것 같아요',
        nextRunAt: '내일 08:00',
      }),
    ).toBe(
      '🔴 *포트폴리오 사이트 발행* 작업이 멈췄어요\n원인: 로그인이 만료된 것 같아요 (추정)\n지금 상태: 내일 08:00에 다시 시도해요.',
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
