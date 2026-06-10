import {
  buildCodexArgs,
  buildCodexPrompt,
  CodexQuotaScanner,
  detectCodexQuotaExhaustion,
} from './codex-cli.provider';

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

describe('detectCodexQuotaExhaustion', () => {
  it('쿼터/사용량 관련 신호가 없는 일반 출력은 exhausted=false', () => {
    expect(detectCodexQuotaExhaustion('hello, here is your plan')).toEqual({
      exhausted: false,
    });
    expect(detectCodexQuotaExhaustion('')).toEqual({ exhausted: false });
  });

  it("codex 의 'You've hit your usage limit ... try again at <시각>' 출력을 쿼터 소진으로 감지하고 reset 시각을 추출한다", () => {
    const output =
      "ERROR: You've hit your usage limit. Upgrade to Pro or try again at Jun 11th, 2026 9:28 AM.";
    expect(detectCodexQuotaExhaustion(output)).toEqual({
      exhausted: true,
      resetHint: 'Jun 11th, 2026 9:28 AM',
    });
  });

  it("reset 시각 힌트가 없는 'usage limit' 출력도 exhausted=true (resetHint 생략)", () => {
    expect(
      detectCodexQuotaExhaustion('You have reached your usage limit.'),
    ).toEqual({ exhausted: true });
  });

  it('rate limit / quota 단어도 쿼터 소진 신호로 본다', () => {
    expect(
      detectCodexQuotaExhaustion('429 rate limit exceeded').exhausted,
    ).toBe(true);
    expect(
      detectCodexQuotaExhaustion('quota exceeded for this account').exhausted,
    ).toBe(true);
  });

  it("'try again in 2 hours' 형태의 상대 시각도 resetHint 로 추출한다", () => {
    expect(
      detectCodexQuotaExhaustion('usage limit reached, try again in 2 hours'),
    ).toEqual({ exhausted: true, resetHint: '2 hours' });
  });

  it('resetHint 가 비정상적으로 길면 cap 해 prose 폭주 / 시크릿 노출을 막는다', () => {
    const longTail = 'a'.repeat(300);
    const result = detectCodexQuotaExhaustion(
      `usage limit, try again at ${longTail}`,
    );
    expect(result.exhausted).toBe(true);
    expect(result.resetHint).toBeDefined();
    expect(result.resetHint!.length).toBeLessThanOrEqual(80);
  });
});

describe('CodexQuotaScanner', () => {
  it('쿼터 신호가 없으면 exhausted=false 유지', () => {
    const scanner = new CodexQuotaScanner();
    scanner.feed('codex progress log...');
    scanner.feed('thinking...');
    expect(scanner.result).toEqual({ exhausted: false });
  });

  it('여러 청크에 걸쳐 쪼개져 들어온 신호도 누적 버퍼로 감지한다 (청크 경계 분할 방어)', () => {
    const scanner = new CodexQuotaScanner();
    scanner.feed("ERROR: You've hit your usage li");
    scanner.feed('mit. try again at Jun 11th, 2026 9:28 AM.');
    expect(scanner.result).toEqual({
      exhausted: true,
      resetHint: 'Jun 11th, 2026 9:28 AM',
    });
  });

  it('한 번 감지하면 이후 대량 로그가 마커를 버퍼 밖으로 밀어내도 sticky 하게 유지한다 (tail truncation 방어)', () => {
    const scanner = new CodexQuotaScanner();
    scanner.feed(
      "You've hit your usage limit. try again at Jun 11th, 2026 9:28 AM.",
    );
    // 마커보다 훨씬 긴 후속 로그 — 단순 tail 방식이면 마커가 윈도우 밖으로 밀려난다.
    scanner.feed('z'.repeat(5000));
    expect(scanner.result.exhausted).toBe(true);
    expect(scanner.result.resetHint).toBe('Jun 11th, 2026 9:28 AM');
  });
});
