import { writeFile } from 'node:fs/promises';

import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import {
  buildCodexArgs,
  buildCodexPrompt,
  CODEX_MODEL,
  CODEX_REASONING_EFFORT,
  CodexCliProvider,
  CodexQuotaExceededException,
  CodexQuotaScanner,
  computeCodexRetryBackoffMs,
  computeQuotaBlockUntilMs,
  detectCodexQuotaExhaustion,
  isRetryableCodexError,
} from './codex-cli.provider';

type ProviderWithCompleteOnce = {
  completeOnce: (
    request: CompletionRequest,
    timeoutMs?: number,
  ) => Promise<CompletionResponse>;
};

type ProviderWithSpawnCodex = ProviderWithCompleteOnce & {
  spawnCodex: (options: {
    args: string[];
    cwd: string;
    homeDir: string;
    stdinPayload: string;
    timeoutMs: number;
  }) => Promise<{
    quotaDetection: {
      exhausted: boolean;
      resetHint?: string;
    };
  }>;
};

const request: CompletionRequest = {
  prompt: 'hello',
};

const response: CompletionResponse = {
  text: 'world',
  modelUsed: 'codex-cli',
  provider: ModelProviderName.CHATGPT,
};

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

  it('사용자 config.toml 을 읽지 않는다 (config 유래 MCP 서버·플러그인·hook 차단)', () => {
    const args = buildCodexArgs({ outputFile: '/tmp/out.txt' });
    expect(args).toContain('--ignore-user-config');
  });

  it('config 를 무시해도 모델 설정은 -c 와 짝지어 재주입한다 (effort 가 none 으로 떨어지지 않게)', () => {
    const args = buildCodexArgs({ outputFile: '/tmp/out.txt' });
    // 값만 배열에 있어도 앞에 `-c` 가 없으면 override 가 먹지 않으므로 짝까지 확인한다.
    const modelIndex = args.indexOf(`model="${CODEX_MODEL}"`);
    expect(modelIndex).toBeGreaterThan(0);
    expect(args[modelIndex - 1]).toBe('-c');

    const effortIndex = args.indexOf(
      `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
    );
    expect(effortIndex).toBeGreaterThan(0);
    expect(args[effortIndex - 1]).toBe('-c');
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

describe('isRetryableCodexError', () => {
  it('CodexQuotaExceededException 은 즉시 전파 대상으로 본다', () => {
    expect(isRetryableCodexError(new CodexQuotaExceededException())).toBe(
      false,
    );
  });

  it('일반 Error 는 재시도 대상으로 본다', () => {
    expect(isRetryableCodexError(new Error('temporary failure'))).toBe(true);
  });

  it('문자열과 undefined 도 재시도 대상으로 본다', () => {
    expect(isRetryableCodexError('temporary failure')).toBe(true);
    expect(isRetryableCodexError(undefined)).toBe(true);
  });
});

describe('computeCodexRetryBackoffMs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Math.random 이 0 이면 base 값으로 계산한다', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);

    expect(computeCodexRetryBackoffMs()).toBe(1000);
  });

  it('Math.random 이 1 바로 아래면 base+jitter 미만 값으로 계산한다', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.999);

    expect(computeCodexRetryBackoffMs()).toBe(1999);
  });
});

describe('computeQuotaBlockUntilMs', () => {
  const fallbackMs = 30 * 60 * 1000;
  const maximumMs = 24 * 60 * 60 * 1000;

  it.each([undefined, '', '   '])(
    'resetHint=%p 이면 30분 fallback 을 반환한다',
    (resetHint) => {
      const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

      expect(computeQuotaBlockUntilMs(resetHint, nowMs)).toBe(
        nowMs + fallbackMs,
      );
    },
  );

  it('ordinal suffix 를 제거해 절대 시각을 해석한다', () => {
    const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs('Aug 8th, 2026 7:00 PM', nowMs)).toBe(
      new Date(2026, 7, 8, 19, 0, 0).getTime(),
    );
  });

  it('날짜 없는 시각을 오늘 날짜에 붙여 해석한다', () => {
    const nowMs = new Date(2026, 7, 8, 18, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs('7:00 PM', nowMs)).toBe(
      new Date(2026, 7, 8, 19, 0, 0).getTime(),
    );
  });

  it('날짜 없는 시각이 이미 지났으면 다음 날로 해석한다', () => {
    const nowMs = new Date(2026, 7, 8, 20, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs('7:00 PM', nowMs)).toBe(
      new Date(2026, 7, 9, 19, 0, 0).getTime(),
    );
  });

  it.each(['in 2 hours', 'not-a-date'])(
    '상대 표현 또는 파싱 불가 값 %p 은 30분 fallback 을 반환한다',
    (resetHint) => {
      const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

      expect(computeQuotaBlockUntilMs(resetHint, nowMs)).toBe(
        nowMs + fallbackMs,
      );
    },
  );

  it.each([
    ['0 seconds', 0],
    ['10 seconds', 10_000],
    ['2 hours', 7_200_000],
  ])('상대 시간 %s 을 현재 시각 기준으로 계산한다', (resetHint, offsetMs) => {
    const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs(resetHint, nowMs)).toBe(nowMs + offsetMs);
  });

  it('24시간보다 긴 상대 시간은 24시간 상한으로 clamp 한다', () => {
    const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs('3 days', nowMs)).toBe(nowMs + maximumMs);
  });

  it('파싱한 절대 시각이 과거이면 30분 fallback 을 반환한다', () => {
    const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs('Aug 7th, 2026 7:00 PM', nowMs)).toBe(
      nowMs + fallbackMs,
    );
  });

  it('파싱한 시각이 24시간보다 멀면 24시간 상한으로 clamp 한다', () => {
    const nowMs = new Date(2026, 7, 8, 12, 0, 0).getTime();

    expect(computeQuotaBlockUntilMs('Aug 10th, 2026 7:00 PM', nowMs)).toBe(
      nowMs + maximumMs,
    );
  });
});

describe('CodexCliProvider quota block', () => {
  const resetHint = 'Aug 8th, 2026 7:00 PM';
  const beforeResetMs = new Date(2026, 7, 8, 18, 0, 0).getTime();
  const afterResetMs = new Date(2026, 7, 8, 19, 0, 1).getTime();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const mockQuotaSpawn = (provider: CodexCliProvider) =>
    jest
      .spyOn(provider as unknown as ProviderWithSpawnCodex, 'spawnCodex')
      .mockImplementation(async ({ args }) => {
        const outputFile = args[args.indexOf('-o') + 1];
        await writeFile(outputFile, '');
        return {
          quotaDetection: {
            exhausted: true,
            resetHint,
          },
        };
      });

  it('쿼터 소진 후 리셋 전에는 spawn 하지 않고, 리셋 후에는 다시 spawn 한다', async () => {
    const provider = new CodexCliProvider();
    const providerWithPrivateMethods =
      provider as unknown as ProviderWithSpawnCodex;
    const spawnCodexSpy = mockQuotaSpawn(provider);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(beforeResetMs);

    await expect(
      providerWithPrivateMethods.completeOnce(request),
    ).rejects.toMatchObject({
      name: 'CodexQuotaExceededException',
      resetHint,
    });
    expect(spawnCodexSpy).toHaveBeenCalledTimes(1);

    await expect(
      providerWithPrivateMethods.completeOnce(request),
    ).rejects.toMatchObject({
      name: 'CodexQuotaExceededException',
      resetHint,
    });
    expect(spawnCodexSpy).toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(afterResetMs);
    await expect(
      providerWithPrivateMethods.completeOnce(request),
    ).rejects.toBeInstanceOf(CodexQuotaExceededException);
    expect(spawnCodexSpy).toHaveBeenCalledTimes(2);
  });

  it('차단 중 probeReadiness 는 spawn 없이 false 를 반환한다', async () => {
    const provider = new CodexCliProvider();
    const providerWithPrivateMethods =
      provider as unknown as ProviderWithSpawnCodex;
    const spawnCodexSpy = mockQuotaSpawn(provider);
    jest.spyOn(Date, 'now').mockReturnValue(beforeResetMs);

    await expect(
      providerWithPrivateMethods.completeOnce(request),
    ).rejects.toBeInstanceOf(CodexQuotaExceededException);
    expect(spawnCodexSpy).toHaveBeenCalledTimes(1);

    await expect(provider.probeReadiness()).resolves.toBe(false);
    expect(spawnCodexSpy).toHaveBeenCalledTimes(1);
  });

  it('먼저 시작한 성공 호출이 뒤에서 설정된 quota 차단을 해제하지 않는다', async () => {
    const provider = new CodexCliProvider();
    const providerWithPrivateMethods =
      provider as unknown as ProviderWithSpawnCodex;
    jest.spyOn(Date, 'now').mockReturnValue(beforeResetMs);

    let spawnCallCount = 0;
    let finishSuccessfulSpawn: (() => Promise<void>) | undefined;
    let markSuccessfulSpawnStarted: (() => void) | undefined;
    const successfulSpawnStarted = new Promise<void>((resolve) => {
      markSuccessfulSpawnStarted = resolve;
    });
    const spawnCodexSpy = jest
      .spyOn(providerWithPrivateMethods, 'spawnCodex')
      .mockImplementation(async ({ args }) => {
        spawnCallCount += 1;
        const outputFile = args[args.indexOf('-o') + 1];

        if (spawnCallCount === 1) {
          return await new Promise((resolve) => {
            finishSuccessfulSpawn = async () => {
              await writeFile(outputFile, 'world');
              resolve({ quotaDetection: { exhausted: false } });
            };
            markSuccessfulSpawnStarted?.();
          });
        }

        await writeFile(outputFile, '');
        return {
          quotaDetection: {
            exhausted: true,
            resetHint,
          },
        };
      });

    const successfulCall = providerWithPrivateMethods.completeOnce(request);
    await successfulSpawnStarted;

    await expect(
      providerWithPrivateMethods.completeOnce(request),
    ).rejects.toBeInstanceOf(CodexQuotaExceededException);
    expect(spawnCodexSpy).toHaveBeenCalledTimes(2);

    if (!finishSuccessfulSpawn) {
      throw new Error('성공 spawn 완료 함수가 설정되지 않았습니다.');
    }
    await finishSuccessfulSpawn();
    await expect(successfulCall).resolves.toEqual(response);

    await expect(
      providerWithPrivateMethods.completeOnce(request),
    ).rejects.toBeInstanceOf(CodexQuotaExceededException);
    expect(spawnCodexSpy).toHaveBeenCalledTimes(2);
  });
});

describe('CodexCliProvider.complete retry loop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const resolveRetryDelay = async (): Promise<void> => {
    await Promise.resolve();
    jest.runOnlyPendingTimers();
    await Promise.resolve();
  };

  it('1회차 성공이면 completeOnce 를 한 번만 호출하고 결과를 반환한다', async () => {
    const provider = new CodexCliProvider();
    const completeOnceSpy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockResolvedValue(response);

    await expect(provider.complete(request)).resolves.toEqual(response);
    expect(completeOnceSpy).toHaveBeenCalledTimes(1);
  });

  it('1회차 일반 실패 후 2회차 성공이면 2회차 결과를 반환한다', async () => {
    const provider = new CodexCliProvider();
    const completeOnceSpy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(response);

    const resultPromise = provider.complete(request);
    await resolveRetryDelay();

    await expect(resultPromise).resolves.toEqual(response);
    expect(completeOnceSpy).toHaveBeenCalledTimes(2);
  });

  it('1회차 CodexQuotaExceededException 은 재시도하지 않고 즉시 전파한다', async () => {
    const provider = new CodexCliProvider();
    const quotaError = new CodexQuotaExceededException('10분 후');
    const completeOnceSpy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockRejectedValueOnce(quotaError);

    await expect(provider.complete(request)).rejects.toBe(quotaError);
    expect(completeOnceSpy).toHaveBeenCalledTimes(1);
  });

  it('2회 모두 일반 실패하면 마지막 error 를 전파한다', async () => {
    const provider = new CodexCliProvider();
    const firstError = new Error('first temporary failure');
    const secondError = new Error('second temporary failure');
    const completeOnceSpy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockRejectedValueOnce(firstError)
      .mockRejectedValueOnce(secondError);

    const resultPromise = provider.complete(request);
    await resolveRetryDelay();

    await expect(resultPromise).rejects.toBe(secondError);
    expect(completeOnceSpy).toHaveBeenCalledTimes(2);
  });
});

describe('CodexCliProvider.probeReadiness (절전 직후 준비 확인)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('probe(completeOnce)가 성공하면 true 를 반환한다', async () => {
    const provider = new CodexCliProvider();
    const spy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockResolvedValue(response);

    await expect(provider.probeReadiness()).resolves.toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('probe 가 실패하면 false 를 반환하고 bounded retry 를 타지 않는다(호출 1회)', async () => {
    const provider = new CodexCliProvider();
    const spy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockRejectedValue(new Error('backend 503'));

    await expect(provider.probeReadiness()).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('일반 호출(180s)보다 짧은 30s 타임아웃으로 probe 한다', async () => {
    const provider = new CodexCliProvider();
    const spy = jest
      .spyOn(provider as unknown as ProviderWithCompleteOnce, 'completeOnce')
      .mockResolvedValue(response);

    await provider.probeReadiness();

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: expect.any(String) }),
      30_000,
    );
  });
});
