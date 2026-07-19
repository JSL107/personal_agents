import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import { LLM_CLI_TIMEOUT_MS } from '../../common/llm/llm-timeout.constant';
import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { buildSafeChildEnv, killProcessTree } from './cli-process.util';
import { redactPii } from './pii-redaction.util';

const CODEX_EXECUTABLE = 'codex';
// 공유 상수 — worker lockDuration(common/queue/worker-options.constant.ts) 도 이 값을 참조한다.
const CODEX_DEFAULT_TIMEOUT_MS = LLM_CLI_TIMEOUT_MS;
const CODEX_MAX_ATTEMPTS = 2;
const CODEX_RETRY_BACKOFF_BASE_MS = 1000;
const CODEX_RETRY_BACKOFF_JITTER_MS = 1000;
const STDERR_TAIL_LIMIT = 500;
// 절전 직후 codex 백엔드 준비 확인용 경량 probe — 짧은 프롬프트 + 짧은 타임아웃으로 성패만 빠르게 본다.
// (일반 호출의 180s 타임아웃을 그대로 쓰면 백엔드가 죽어 있을 때 probe 한 번에 3분을 낭비한다.)
const CODEX_PROBE_TIMEOUT_MS = 30_000;
const CODEX_PROBE_PROMPT = 'Reply with the single word: OK';

// codex CLI 가 사용량 한도(ChatGPT 구독 쿼터)에 닿으면 exit=0 이어도 output-last-message 가 비고,
// stdout/stderr 에 "You've hit your usage limit ... try again at <시각>" 류 문구가 찍힌다.
// 이 신호를 일반 빈 응답과 구분해 상위(model-router)가 친절한 쿼터 안내를 만들 수 있게 한다.
const CODEX_QUOTA_SIGNAL_REGEX =
  /usage limit|hit your usage|reached your usage|rate limit|over your usage|quota/i;
// "try again at Jun 11th, 2026 9:28 AM." / "try again in 2 hours" 등에서 리셋 힌트만 추출 ('.' 직전까지).
const CODEX_QUOTA_RESET_HINT_REGEX = /try again (?:at|in) ([^\n.]+)/i;
// resetHint 는 raw stdout 에서 뽑으므로 prose 폭주 / 시크릿 노출을 막기 위해 길이를 cap 한다 (시각 문구는 ~25자).
const CODEX_RESET_HINT_MAX = 80;
// 쿼터 마커가 후속 진행 로그에 밀려 tail 밖으로 빠지지 않도록 스캔용 누적 버퍼 한도 (Claude provider 와 동급).
const CODEX_QUOTA_SCAN_BUFFER_LIMIT = 2000;

export type CodexQuotaDetection = {
  exhausted: boolean;
  resetHint?: string;
};

// codex 출력(stdout+stderr)에서 쿼터 소진 여부 + 리셋 시각 힌트를 뽑는 순수 함수.
// 부작용 없이 string 만 받으므로 단위 테스트가 쉽고, CodexQuotaScanner 가 청크 누적 버퍼에 대해 재사용한다.
export const detectCodexQuotaExhaustion = (
  output: string,
): CodexQuotaDetection => {
  if (!CODEX_QUOTA_SIGNAL_REGEX.test(output)) {
    return { exhausted: false };
  }
  const match = output.match(CODEX_QUOTA_RESET_HINT_REGEX);
  if (match) {
    const hint = match[1].trim().slice(0, CODEX_RESET_HINT_MAX).trim();
    if (hint.length > 0) {
      return { exhausted: true, resetHint: hint };
    }
  }
  return { exhausted: true };
};

// codex exec 는 stdout 에 진행 로그를 흘리다가 쿼터 소진 시 그 사이 "usage limit ... try again at <시각>" 를 끼워 넣는다.
// 단순히 마지막 N자(tail)만 보면 마커가 후속 로그에 밀려 사라질 수 있어, 누적 버퍼에서 스캔하고 한 번 감지하면 sticky 하게 고정한다.
// (버퍼는 메모리 폭주 방지를 위해 마지막 CODEX_QUOTA_SCAN_BUFFER_LIMIT 자만 유지 — 마커가 이 윈도우에 온전히 들어온 순간 잡는다.)
export class CodexQuotaScanner {
  private buffer = '';
  private detection: CodexQuotaDetection = { exhausted: false };

  feed(chunk: string): void {
    // 신호(exhausted)뿐 아니라 reset 시각 힌트까지 확보하면 고정 — 신호 단어와 "try again at <시각>" 이
    // 서로 다른 청크에 쪼개져 와도 힌트를 놓치지 않게 한다 (힌트가 끝내 없으면 exhausted 만 sticky 유지).
    if (this.detection.exhausted && this.detection.resetHint) {
      return;
    }
    this.buffer = (this.buffer + chunk).slice(-CODEX_QUOTA_SCAN_BUFFER_LIMIT);
    const found = detectCodexQuotaExhaustion(this.buffer);
    if (found.exhausted) {
      this.detection = found;
    }
  }

  get result(): CodexQuotaDetection {
    return this.detection;
  }
}

// codex(ChatGPT) 사용량 한도 초과를 일반 실패와 구분하기 위한 전용 예외.
// model-router 가 instanceof 로 식별해 (1) Claude fallback 후 (2) 실패 시 reset 시각을 친절히 안내한다.
export class CodexQuotaExceededException extends Error {
  constructor(readonly resetHint?: string) {
    super(
      resetHint
        ? `codex(ChatGPT) 사용량 한도 초과 — ${resetHint} 에 리셋됩니다.`
        : 'codex(ChatGPT) 사용량 한도 초과.',
    );
    this.name = 'CodexQuotaExceededException';
  }
}

export const isRetryableCodexError = (error: unknown): boolean => {
  const retryable = !(error instanceof CodexQuotaExceededException);
  return retryable;
};

export const computeCodexRetryBackoffMs = (): number => {
  const jitterMs = Math.floor(Math.random() * CODEX_RETRY_BACKOFF_JITTER_MS);
  return CODEX_RETRY_BACKOFF_BASE_MS + jitterMs;
};

type CodexSpawnResult = {
  quotaDetection: CodexQuotaDetection;
};

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// ChatGPT Plus 구독 기반의 codex CLI 를 non-interactive 모드(`codex exec`)로 호출하는 어댑터.
// API key 없이 개인 구독 쿼터로 PM / Work Reviewer 에이전트를 굴리기 위한 경로다.
// - 출력은 --output-last-message 로 임시 파일에 떨어뜨려 파싱 안정성을 확보 (stdout 은 진행 로그 섞임).
// - 프롬프트는 argv 가 아니라 **stdin 으로 전달** — argv 는 `ps aux` 로 host 의 다른 프로세스가 볼 수 있어 Slack 입력이 유출될 수 있다.
// - cwd / HOME 모두 throwaway 임시 디렉토리로 격리해 prompt-injected agent 의 repo / ~/.ssh 접근을 차단.

export const buildCodexPrompt = ({
  prompt,
  systemPrompt,
}: {
  prompt: string;
  systemPrompt?: string;
}): string => {
  if (!systemPrompt) {
    return prompt;
  }
  return `[System Instructions]\n${systemPrompt}\n\n[User]\n${prompt}`;
};

export const buildCodexArgs = ({
  outputFile,
}: {
  outputFile: string;
}): string[] => [
  'exec',
  '--skip-git-repo-check',
  '--sandbox',
  'read-only',
  '--ephemeral',
  '--color',
  'never',
  '-o',
  outputFile,
];

@Injectable()
export class CodexCliProvider implements ModelProviderPort {
  readonly name = ModelProviderName.CHATGPT;
  private readonly logger = new Logger(CodexCliProvider.name);
  private readonly timeoutMs: number = CODEX_DEFAULT_TIMEOUT_MS;

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= CODEX_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.completeOnce(request);
      } catch (error: unknown) {
        lastError = error;
        if (!isRetryableCodexError(error) || attempt >= CODEX_MAX_ATTEMPTS) {
          throw error;
        }
        const backoffMs = computeCodexRetryBackoffMs();
        const message =
          error instanceof Error ? error.message.slice(0, 200) : String(error);
        this.logger.warn(
          `codex 호출 실패 — 재시도 (attempt ${attempt + 1}/${CODEX_MAX_ATTEMPTS}), ${backoffMs}ms 후: ${message}`,
        );
        await delay(backoffMs);
      }
    }

    throw lastError;
  }

  // 절전에서 깨어난 직후 등, codex 백엔드가 지금 호출을 받을 수 있는지 경량 확인한다.
  // 짧은 프롬프트를 짧은 타임아웃으로 1회 호출 — 성공하면 준비됨(true), 어떤 실패든 미준비(false).
  // 재시도는 호출자(SystemWakeGuard 폴링)가 담당하므로 여기선 bounded retry 를 타지 않는다.
  async probeReadiness(): Promise<boolean> {
    try {
      await this.completeOnce(
        { prompt: CODEX_PROBE_PROMPT },
        CODEX_PROBE_TIMEOUT_MS,
      );
      return true;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : String(error);
      this.logger.warn(
        `codex readiness probe 실패 (백엔드 미준비 추정): ${message}`,
      );
      return false;
    }
  }

  private async completeOnce(
    request: CompletionRequest,
    timeoutMs: number = this.timeoutMs,
  ): Promise<CompletionResponse> {
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-home-'));
    const outputFile = join(workDir, 'response.txt');

    try {
      const args = buildCodexArgs({ outputFile });
      // OPS-4: 외부 CLI 로 흘려보내기 직전 토큰 류 시크릿을 redact —
      // GitHub issue body / Slack mention / Notion property 가 prompt 에 inline 으로 들어가는 surface 차단.
      const stdinPayload = redactPii(buildCodexPrompt(request));
      const { quotaDetection } = await this.spawnCodex({
        args,
        cwd: workDir,
        homeDir,
        stdinPayload,
        timeoutMs,
      });
      const text = (await readFile(outputFile, 'utf-8')).trim();

      if (text.length === 0) {
        // exit=0 이지만 output-last-message 가 비어있는 드문 상태 — 인증 만료/쿼터 소진/프롬프트 필터링 등에서 관찰됨.
        // 그 중 쿼터 소진은 stdout 에 "usage limit ... try again at <시각>" 가 남으므로 (스캐너가 누적 감지) 전용 예외로 구분한다.
        // (model-router 가 이 예외를 보고 Claude fallback → 실패 시 reset 시각 친절 안내.)
        if (quotaDetection.exhausted) {
          throw new CodexQuotaExceededException(quotaDetection.resetHint);
        }
        // 빈 문자열을 그대로 전파하면 상위 parser 가 "JSON 파싱 실패" 로 잘못 보고하므로 명확한 진단 메시지로 끊는다.
        throw new Error(
          'codex CLI 가 빈 응답을 반환했습니다 (인증 상태/쿼터/프롬프트 필터를 확인해주세요).',
        );
      }

      return {
        text,
        modelUsed: 'codex-cli',
        provider: ModelProviderName.CHATGPT,
      };
    } finally {
      await Promise.all([
        rm(workDir, { recursive: true, force: true }),
        rm(homeDir, { recursive: true, force: true }),
      ]);
    }
  }

  private spawnCodex({
    args,
    cwd,
    homeDir,
    stdinPayload,
    timeoutMs,
  }: {
    args: string[];
    cwd: string;
    homeDir: string;
    stdinPayload: string;
    timeoutMs: number;
  }): Promise<CodexSpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(CODEX_EXECUTABLE, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: buildSafeChildEnv({ cwd, homeDir }),
        // 프로세스 그룹 리더로 띄워, timeout 시 codex 가 띄운 broker/grandchild 까지
        // killProcessTree 로 한 번에 정리 (자식만 죽으면 grandchild 가 stdio 를 물고
        // 'close' 를 막아 Promise 가 hang — 단일 호출 16분 지속 관측의 유력 원인).
        detached: true,
      });

      let stdoutTail = '';
      let stderrTail = '';
      // 쿼터 마커는 후속 진행 로그에 밀려 tail 밖으로 빠질 수 있어, tail 과 별개로 sticky 누적 스캐너로 감지한다.
      const quotaScanner = new CodexQuotaScanner();

      const timer = setTimeout(() => {
        this.logger.warn(
          `codex CLI 응답 시간 초과 (${timeoutMs}ms) — 프로세스 그룹 강제 종료 (pid=${child.pid})`,
        );
        killProcessTree(child.pid);
        reject(new Error(`codex CLI 응답 시간 초과 (${timeoutMs}ms)`));
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutTail = (stdoutTail + text).slice(-STDERR_TAIL_LIMIT);
        quotaScanner.feed(text);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrTail = (stderrTail + text).slice(-STDERR_TAIL_LIMIT);
        quotaScanner.feed(text);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ quotaDetection: quotaScanner.result });
          return;
        }
        const suffix = stderrTail || stdoutTail || '(no output)';
        this.logger.error(`codex CLI exit=${code} tail=${suffix.slice(-200)}`);
        // exit≠0 이면서 쿼터 신호가 있으면 generic 비정상 종료 대신 전용 예외로 끊는다.
        if (quotaScanner.result.exhausted) {
          reject(
            new CodexQuotaExceededException(quotaScanner.result.resetHint),
          );
          return;
        }
        reject(new Error(`codex CLI 비정상 종료 (exit=${code}): ${suffix}`));
      });

      // prompt 는 argv 가 아니라 stdin 으로 전달 — ps aux 노출 방지 + ARG_MAX 제한 회피.
      // codex exec 는 PROMPT 위치 인자가 없으면 stdin 에서 읽는다.
      child.stdin?.write(stdinPayload);
      child.stdin?.end();
    });
  }
}
