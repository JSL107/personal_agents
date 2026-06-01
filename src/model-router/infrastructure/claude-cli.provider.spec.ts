import {
  buildClaudeArgs,
  buildClaudeExitErrorMessage,
  ClaudeAuthSuspectException,
  isClaudeAuthSuspect,
  parseClaudeJsonOutput,
} from './claude-cli.provider';

describe('buildClaudeArgs', () => {
  it('기본 플래그는 print / output-format json / no-session-persistence / model opus 를 포함한다', () => {
    const args = buildClaudeArgs({});
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'json',
        '--no-session-persistence',
        '--model',
        'opus',
      ]),
    );
  });

  it('model 옵션을 넘기면 해당 모델로 지정한다 (env override 경로)', () => {
    const args = buildClaudeArgs({ model: 'sonnet' });
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).not.toContain('opus');
  });

  it('--bare 는 포함하지 않는다 (keychain/OAuth 인증 유지)', () => {
    const args = buildClaudeArgs({});
    expect(args).not.toContain('--bare');
  });

  it('positional prompt 를 argv 로 넘기지 않는다 (stdin 전달이라 `--` 등 terminator 불필요)', () => {
    const args = buildClaudeArgs({ systemPrompt: 'be concise' });
    expect(args).not.toContain('--');
  });

  it('systemPrompt 이 있으면 --system-prompt 플래그를 추가한다', () => {
    const args = buildClaudeArgs({ systemPrompt: 'you are helpful' });
    expect(args).toContain('--system-prompt');
    expect(args).toContain('you are helpful');
  });

  it('systemPrompt 이 없으면 --system-prompt 플래그를 추가하지 않는다', () => {
    const args = buildClaudeArgs({});
    expect(args).not.toContain('--system-prompt');
  });
});

describe('parseClaudeJsonOutput', () => {
  it('result / model 필드를 추출한다', () => {
    const raw = JSON.stringify({
      type: 'result',
      result: '안녕하세요',
      model: 'claude-sonnet-4-6',
    });

    const { text, modelUsed } = parseClaudeJsonOutput(raw);

    expect(text).toBe('안녕하세요');
    expect(modelUsed).toBe('claude-sonnet-4-6');
  });

  it('model 이 없으면 기본값 claude-cli 로 fallback 한다', () => {
    const raw = JSON.stringify({ result: 'ok' });

    const { modelUsed } = parseClaudeJsonOutput(raw);

    expect(modelUsed).toBe('claude-cli');
  });

  it('is_error=true 이면 예외를 던진다', () => {
    const raw = JSON.stringify({ is_error: true, result: 'boom' });

    expect(() => parseClaudeJsonOutput(raw)).toThrow(/is_error/);
  });

  it('JSON 이 아니면 예외를 던진다', () => {
    expect(() => parseClaudeJsonOutput('not json')).toThrow();
  });
});

describe('isClaudeAuthSuspect — 침묵 실패 / 인증 키워드 감지', () => {
  it('exit=1 + 빈 stderr 는 인증 만료/쿼터 소진 의심', () => {
    expect(isClaudeAuthSuspect({ code: 1, stderrTail: '' })).toBe(true);
  });

  it('exit=1 + 공백만 있는 stderr 도 의심으로 판정', () => {
    expect(isClaudeAuthSuspect({ code: 1, stderrTail: '   \n  ' })).toBe(true);
  });

  it('exit=1 + stderr 에 인증 키워드 (Please run /login) 포함 시 의심', () => {
    expect(
      isClaudeAuthSuspect({ code: 1, stderrTail: 'Please run /login first' }),
    ).toBe(true);
  });

  it('exit=1 + stderr 에 rate limit 포함 시 의심', () => {
    expect(
      isClaudeAuthSuspect({ code: 1, stderrTail: 'You hit rate limit (429).' }),
    ).toBe(true);
  });

  it('exit=1 이라도 인증 키워드 없는 일반 에러는 의심 아님', () => {
    expect(
      isClaudeAuthSuspect({
        code: 1,
        stderrTail: 'TypeError: foo is not a function',
      }),
    ).toBe(false);
  });

  it('exit=2 등 다른 비정상 종료는 의심 아님 (오직 exit=1 만)', () => {
    expect(isClaudeAuthSuspect({ code: 2, stderrTail: '' })).toBe(false);
  });
});

describe('buildClaudeExitErrorMessage — 사용자 향 안내', () => {
  it('인증 의심 케이스는 재인증 가이드 메시지를 포함한다', () => {
    const message = buildClaudeExitErrorMessage({ code: 1, stderrTail: '' });
    expect(message).toMatch(/인증 만료 \/ 쿼터 소진 의심/);
    expect(message).toMatch(/대화형으로 실행해 재인증/);
  });

  it('일반 에러는 기존 형식 유지 (인증 가이드 없음)', () => {
    const message = buildClaudeExitErrorMessage({
      code: 127,
      stderrTail: 'command not found',
    });
    expect(message).toMatch(/claude CLI 비정상 종료 \(exit=127\)/);
    expect(message).not.toMatch(/인증 만료/);
  });
});

describe('ClaudeAuthSuspectException', () => {
  it('Error 의 sub class 로 name 이 ClaudeAuthSuspectException 이다', () => {
    const e = new ClaudeAuthSuspectException('test');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ClaudeAuthSuspectException');
    expect(e.message).toBe('test');
  });
});
