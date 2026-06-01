import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { buildSafeChildEnv } from './cli-process.util';
import { redactPii } from './pii-redaction.util';

const CLAUDE_EXECUTABLE = 'claude';
const CLAUDE_DEFAULT_TIMEOUT_MS = 180_000;
const STREAM_TAIL_LIMIT = 2000;

// Claude Max 구독 기반의 claude CLI 를 print 모드(`-p`)로 호출하는 어댑터.
// Code Reviewer / BE 에이전트가 사용하는 경로 (기획서 §13). API key 없이 구독 쿼터로 동작한다.
// - 출력은 --output-format json 으로 stdout 에 단일 JSON 객체 (`{ result: "..." }`) 를 떨어뜨린다.
// - `--bare` 는 keychain/OAuth 인증을 차단하므로 (Max 구독 인증 안 됨) 사용하지 않는다.
// - 프롬프트는 argv 가 아니라 **stdin 으로 전달** — argv 는 `ps aux` 로 유출될 수 있음 + ARG_MAX 회피.
// - cwd / HOME 모두 throwaway 임시 디렉토리로 격리해 prompt-injected agent 의 repo / ~/.ssh 접근을 차단.

// 이대리가 Claude 를 쓰는 건 개발형 에이전트 (BE, Code Reviewer) 뿐이라 기본 `opus` 로 격상.
// 구독 quota 소진 우려가 있으면 env 로 `sonnet` / `haiku` override 가능.
const DEFAULT_CLAUDE_MODEL = 'opus';

export const buildClaudeArgs = ({
  systemPrompt,
  model = DEFAULT_CLAUDE_MODEL,
}: {
  systemPrompt?: string;
  model?: string;
}): string[] => {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--no-session-persistence',
    '--model',
    model,
  ];
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }
  return args;
};

// claude CLI 가 exit=1 + 빈 stderr 로 침묵 실패하는 경우는 거의 항상 인증 만료 / 쿼터 소진 패턴이다
// (2026-05-30 사고 사례). stderr 에 "Please run /login", "credentials", "unauthorized", "rate limit"
// 키워드가 있을 때도 동일 안내가 유용. 본 fn 은 그 분기를 한 곳에 모아 호출자가 명시적 메시지 +
// dedicated exception 으로 끊을 수 있게 한다.
const CLAUDE_AUTH_STDERR_KEYWORDS = [
  'please run /login',
  'unauthorized',
  'credentials',
  'rate limit',
  'quota',
  'expired',
];

export const isClaudeAuthSuspect = ({
  code,
  stderrTail,
}: {
  code: number | null;
  stderrTail: string;
}): boolean => {
  if (code !== 1) {
    return false;
  }
  const trimmed = stderrTail.trim();
  if (trimmed.length === 0) {
    return true;
  }
  const lowered = trimmed.toLowerCase();
  return CLAUDE_AUTH_STDERR_KEYWORDS.some((keyword) =>
    lowered.includes(keyword),
  );
};

// CLAUDE.md §6 의 "claude CLI exit=0 인데 빈 응답: 인증 만료/쿼터 소진" 함정과 동일 카테고리의
// exit≠0 시그널. ModelRouterUsecase 가 fallback chain 전후로 이 type 을 식별해 owner alert /
// 메트릭 분기 등에 활용할 수 있도록 별도 class 로 분리.
export class ClaudeAuthSuspectException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeAuthSuspectException';
  }
}

export const buildClaudeExitErrorMessage = ({
  code,
  stderrTail,
}: {
  code: number | null;
  stderrTail: string;
}): string => {
  const tail = stderrTail.trim();
  if (isClaudeAuthSuspect({ code, stderrTail })) {
    const suffix = tail.length > 0 ? ` stderr=${tail}` : ' (no stderr)';
    return `claude CLI 인증 만료 / 쿼터 소진 의심 (exit=${code}). \`claude\` 를 한 번 대화형으로 실행해 재인증 또는 쿼터 reset 을 확인해주세요.${suffix}`;
  }
  return `claude CLI 비정상 종료 (exit=${code}): ${tail || '(no stderr)'}`;
};

export const parseClaudeJsonOutput = (
  raw: string,
): { text: string; modelUsed: string } => {
  const parsed = JSON.parse(raw) as {
    result?: unknown;
    model?: unknown;
    is_error?: unknown;
  };

  if (parsed.is_error === true) {
    throw new Error(`claude CLI 가 is_error=true 로 응답: ${raw.slice(-500)}`);
  }

  const text = typeof parsed.result === 'string' ? parsed.result : '';
  const modelUsed =
    typeof parsed.model === 'string' ? parsed.model : 'claude-cli';

  return { text, modelUsed };
};

@Injectable()
export class ClaudeCliProvider implements ModelProviderPort {
  readonly name = ModelProviderName.CLAUDE;
  private readonly logger = new Logger(ClaudeCliProvider.name);
  private readonly timeoutMs: number = CLAUDE_DEFAULT_TIMEOUT_MS;

  constructor(private readonly configService: ConfigService) {}

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-claude-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'idaeri-claude-home-'));

    try {
      const model = this.configService.get<string>('CLAUDE_MODEL')?.trim();
      // OPS-4: stdin (사용자 입력 경로) 뿐 아니라 --system-prompt argv 까지 redact —
      // 정적 상수만 들어오는 경로지만 codex/gemini 와 동일 정책으로 일관성 유지 (codex P1 지적).
      const args = buildClaudeArgs({
        systemPrompt: request.systemPrompt
          ? redactPii(request.systemPrompt)
          : undefined,
        model: model && model.length > 0 ? model : undefined,
      });
      const stdout = await this.spawnClaude({
        args,
        cwd: workDir,
        homeDir,
        stdinPayload: redactPii(request.prompt),
      });
      const { text, modelUsed } = parseClaudeJsonOutput(stdout);

      return {
        text,
        modelUsed,
        provider: ModelProviderName.CLAUDE,
      };
    } finally {
      await Promise.all([
        rm(workDir, { recursive: true, force: true }),
        rm(homeDir, { recursive: true, force: true }),
      ]);
    }
  }

  private spawnClaude({
    args,
    cwd,
    homeDir,
    stdinPayload,
  }: {
    args: string[];
    cwd: string;
    homeDir: string;
    stdinPayload: string;
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(CLAUDE_EXECUTABLE, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: buildSafeChildEnv({ cwd, homeDir }),
      });

      const stdoutChunks: string[] = [];
      let stderrTail = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`claude CLI 응답 시간 초과 (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk.toString());
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STREAM_TAIL_LIMIT);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdoutChunks.join(''));
          return;
        }
        const authSuspect = isClaudeAuthSuspect({ code, stderrTail });
        const message = buildClaudeExitErrorMessage({ code, stderrTail });
        if (authSuspect) {
          this.logger.error(
            `claude CLI exit=${code} AUTH_SUSPECT stderr=${stderrTail.slice(-200) || '(empty)'}`,
          );
          reject(new ClaudeAuthSuspectException(message));
          return;
        }
        this.logger.error(
          `claude CLI exit=${code} stderr=${stderrTail.slice(-200)}`,
        );
        reject(new Error(message));
      });

      // prompt 는 argv 가 아니라 stdin 으로 전달 — ps aux 노출 방지 + ARG_MAX 제한 회피.
      // claude -p 는 positional prompt 없이 stdin 에서 prompt 를 읽는다 (standard pipe pattern).
      child.stdin?.write(stdinPayload);
      child.stdin?.end();
    });
  }
}
