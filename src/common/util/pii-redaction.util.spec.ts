import { redactPii } from './pii-redaction.util';

describe('redactPii', () => {
  it('URL의 모든 scheme과 비밀번호 내부 @, /를 가리고 scheme은 보존한다', () => {
    expect(redactPii('postgresql://user:p@ss/word@db:5434/app')).toBe(
      'postgresql://***@db:5434/app',
    );
    expect(redactPii('redis://u:p@ss@host/0')).toBe('redis://***@host/0');
  });

  it('인용한 JSON 값과 일반 key-value의 모든 비밀 키를 가린다', () => {
    expect(
      redactPii(
        '"password":"x y" password: "x y" token=abc secret: xyz api_key=q apikey=r access_token=s passwd=t pwd=u',
      ),
    ).toBe(
      '"password":"***" password: "***" token=*** secret: *** api_key=*** apikey=*** access_token=*** passwd=*** pwd=***',
    );
  });

  it('작은따옴표로 감싼 비밀 값의 공백까지 모두 가린다', () => {
    expect(
      redactPii(
        "password='hello world' token='a b' secret='c d' api_key='e f'",
      ),
    ).toBe("password='***' token='***' secret='***' api_key='***'");
  });

  it('JSON 비밀 값 안의 이스케이프된 큰따옴표 뒤까지 모두 가린다', () => {
    expect(redactPii(String.raw`{"password":"abc\"def"} tail`)).toBe(
      '{"password":"***"} tail',
    );
  });

  it('Authorization Bearer와 일반 Bearer 토큰을 가린다', () => {
    expect(
      redactPii('Authorization: Bearer opaque123; Bearer second-token'),
    ).toBe('Authorization: Bearer ***; Bearer ***');
    expect(redactPii('token=Bearer private-token')).not.toContain(
      'private-token',
    );
  });
  it('URL 자격증명과 password를 마스킹한다', () => {
    const text = redactPii('https://u:p@h/x password=hunter2 pwd:abc');
    expect(text).not.toMatch(/u:p@|hunter2|pwd:abc/);
    expect(text).toContain('https://***@');
    expect(text).toContain('password=***');
  });

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

  // ── 오탐 방어 ──────────────────────────────────────────────────────────────
  // 이름·전화번호·계좌번호 패턴을 넣자는 요구가 자동 리뷰에서 반복되므로, 확장하면 가장 먼저
  // 깨지는 실제 원장 입력을 고정해 둔다. 아래가 깨지면 패턴을 추가한 쪽이 틀린 것이다.
  // 판정 근거(3,025만 자 실측)는 pii-redaction.util.ts 헤더 주석 참조.

  it('오탐 방어: ISO 날짜를 계좌번호로 오인해 마스킹하지 않는다', () => {
    const input =
      '오늘 plan 요약 (자동 생성, 2026-09-18):\n- [2026-08-13] 배포 완료 (2025-06-22 대비)';
    expect(redactPii(input)).toBe(input);
  });

  it('오탐 방어: 모의투자 부동소수점 payload 를 전화번호/주민번호/카드번호로 오인하지 않는다', () => {
    const input =
      '{"return1m":2.2522522522522515,"return3m":42.61780104712043,"ma60":189509.46666666667,"turnover60":1579264181.6666667,"volatility20":2794.858333333333}';
    expect(redactPii(input)).toBe(input);
  });

  it('오탐 방어: 성씨로 시작하는 일반 한국어 어휘를 이름으로 오인하지 않는다', () => {
    const input =
      '에이전트를 추가했고 백엔드 정합성을 유지하도록 구현했다. 채팅방·오피스 이미지도 확인했다. 제이앤티씨 종목과 오피스 대표 지시 경로는 그대로 둔다.';
    expect(redactPii(input)).toBe(input);
  });
});
