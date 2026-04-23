import { buildClaudeArgs, parseClaudeJsonOutput } from './claude-cli.provider';

describe('buildClaudeArgs', () => {
  it('기본 플래그는 print / output-format json / no-session-persistence 를 포함한다', () => {
    const args = buildClaudeArgs({});
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'json',
        '--no-session-persistence',
      ]),
    );
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
