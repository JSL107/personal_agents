import { buildCodexArgs, buildCodexPrompt } from './codex-cli.provider';

describe('buildCodexPrompt', () => {
  it('systemPrompt 이 없으면 원본 프롬프트를 그대로 반환한다', () => {
    expect(buildCodexPrompt({ prompt: 'hello' })).toBe('hello');
  });

  it('systemPrompt 이 있으면 [System Instructions] / [User] 블록으로 합친다', () => {
    expect(
      buildCodexPrompt({
        prompt: 'user message',
        systemPrompt: 'you are helpful',
      }),
    ).toBe('[System Instructions]\nyou are helpful\n\n[User]\nuser message');
  });
});

describe('buildCodexArgs', () => {
  it('read-only 샌드박스 / ephemeral / 출력 파일 경로 플래그를 포함한다', () => {
    const args = buildCodexArgs({ outputFile: '/tmp/out.txt' });
    expect(args[0]).toBe('exec');
    expect(args).toContain('--skip-git-repo-check');
    expect(args).toContain('--sandbox');
    expect(args).toContain('read-only');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('-o');
    expect(args).toContain('/tmp/out.txt');
  });

  it('positional prompt 를 argv 로 넘기지 않는다 (stdin 전달이라 `--` 등 terminator 불필요)', () => {
    const args = buildCodexArgs({ outputFile: '/tmp/out.txt' });
    // 마지막 항목은 -o 뒤의 outputFile 이어야 한다.
    expect(args[args.length - 1]).toBe('/tmp/out.txt');
    expect(args).not.toContain('--');
  });
});
