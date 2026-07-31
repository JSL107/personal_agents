import {
  escapeSlackMrkdwn,
  isSafeHttpUrl,
  sanitizeForSlackLink,
} from './mrkdwn.util';

describe('sanitizeForSlackLink', () => {
  it('<, >, | 문자만 제거하고 나머지 텍스트는 유지', () => {
    expect(sanitizeForSlackLink('alpha<beta>gamma|delta & /pull/707')).toBe(
      'alphabetagammadelta & /pull/707',
    );
  });

  it('빈 문자열은 빈 문자열 반환', () => {
    expect(sanitizeForSlackLink('')).toBe('');
  });
});

describe('isSafeHttpUrl', () => {
  it.each(['http://example.com', 'https://example.com'])(
    '%s 접두사 URL 은 true 반환',
    (url) => {
      expect(isSafeHttpUrl(url)).toBe(true);
    },
  );

  it.each(['ftp://example.com', '/pull/707', 'pull/707', ''])(
    '%s 는 false 반환',
    (url) => {
      expect(isSafeHttpUrl(url)).toBe(false);
    },
  );
});

describe('escapeSlackMrkdwn', () => {
  it('&를 먼저 escape하고 <, >를 double escape하지 않음', () => {
    expect(escapeSlackMrkdwn('<a & b>')).toBe('&lt;a &amp; b&gt;');
  });

  it('특수 문자가 없는 문자열은 그대로 반환', () => {
    expect(escapeSlackMrkdwn('plain Slack text')).toBe('plain Slack text');
  });

  it('빈 문자열은 빈 문자열 반환', () => {
    expect(escapeSlackMrkdwn('')).toBe('');
  });
});
