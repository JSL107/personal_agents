import { redactPii } from './pii-redaction.util';

describe('redactPii', () => {
  it('Slack bot token (xoxb-) 을 [REDACTED:slack_token] 으로 치환', () => {
    const input = 'context xoxb-1234567890-abcdefghijklmnopqrstuv tail';
    expect(redactPii(input)).toBe('context [REDACTED:slack_token] tail');
  });

  it('Slack user/app 토큰 prefix(xoxp/xoxa/xoxr/xoxs) 도 모두 마스킹', () => {
    const sample = [
      'xoxp-aaaaaaaaaaaaaaaaaaaa',
      'xoxa-bbbbbbbbbbbbbbbbbbbb',
      'xoxr-cccccccccccccccccccc',
      'xoxs-dddddddddddddddddddd',
    ].join(' ');
    const redacted = redactPii(sample);
    expect(redacted).not.toMatch(/xox[apurs]-[A-Za-z0-9]/);
    expect(redacted.match(/\[REDACTED:slack_token\]/g)).toHaveLength(4);
  });

  it('GitHub classic PAT(ghp_) 와 fine-grained PAT(github_pat_) 모두 마스킹', () => {
    const input =
      'tokens=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,github_pat_BBBBBBBBBBBBBBBBBBBB_CCCCCCCCCCCCCCCCCCCC';
    const redacted = redactPii(input);
    expect(redacted).toContain('[REDACTED:github_pat]');
    expect(redacted).not.toContain('ghp_aaaa');
    expect(redacted).not.toContain('github_pat_BBBB');
  });

  it('AWS access key id (AKIA + 16자) 마스킹', () => {
    const input = 'AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP';
    expect(redactPii(input)).toBe(
      'AWS_ACCESS_KEY_ID=[REDACTED:aws_access_key]',
    );
  });

  it('Anthropic API key(sk-ant-) 마스킹', () => {
    const input = 'API=sk-ant-api03-abcdefghijklmnopqrstuvwx';
    expect(redactPii(input)).toContain('[REDACTED:anthropic_key]');
    expect(redactPii(input)).not.toContain('api03-abc');
  });

  it('OpenAI key(sk-) 마스킹 (Anthropic 과 충돌 안 남)', () => {
    const input =
      'OPENAI=sk-abcdefghijklmnopqrstuvwxyzabcdef ANTHROPIC=sk-ant-api03-zzzzzzzzzzzzzzzzzzzz';
    const redacted = redactPii(input);
    expect(redacted).toContain('OPENAI=[REDACTED:openai_key]');
    expect(redacted).toContain('ANTHROPIC=[REDACTED:anthropic_key]');
  });

  it('Google API key(AIza + 35자) 마스킹', () => {
    const input = 'GOOGLE=AIzaSyA-abcdefghijklmnopqrstuvwxyz0123456';
    expect(redactPii(input)).toContain('[REDACTED:google_api_key]');
  });

  it('JWT(header.payload.signature) 마스킹', () => {
    const input =
      'auth=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactPii(input)).toContain('auth=[REDACTED:jwt]');
  });

  it('일반 텍스트는 원본 보존 (이메일 / 일반 영숫자는 redact 안 함)', () => {
    const input =
      'Contact alice@example.com or check issue #123 — see review by @bob.';
    expect(redactPii(input)).toBe(input);
  });

  it('여러 시크릿이 한 입력에 섞여 있어도 각각 별도 마스킹', () => {
    const input =
      'slack=xoxb-AAAAAAAAAAAAAAAAAAAA github=ghp_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB end';
    const redacted = redactPii(input);
    expect(redacted).toContain('slack=[REDACTED:slack_token]');
    expect(redacted).toContain('github=[REDACTED:github_pat]');
    expect(redacted).toContain('end');
  });

  it('빈 문자열은 그대로 빈 문자열 반환', () => {
    expect(redactPii('')).toBe('');
  });
});
