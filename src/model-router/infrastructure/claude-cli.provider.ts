import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { buildSafeChildEnv } from './cli-process.util';

const CLAUDE_EXECUTABLE = 'claude';
const CLAUDE_DEFAULT_TIMEOUT_MS = 180_000;
const STREAM_TAIL_LIMIT = 2000;

// Claude Max 구독 기반의 claude CLI 를 print 모드(`-p`)로 호출하는 어댑터.
// Code Reviewer / BE 에이전트가 사용하는 경로 (기획서 §13). API key 없이 구독 쿼터로 동작한다.
// - 출력은 --output-format json 으로 stdout 에 단일 JSON 객체 (`{ result: "..." }`) 를 떨어뜨린다.
// - `--bare` 는 keychain/OAuth 인증을 차단하므로 (Max 구독 인증 안 됨) 사용하지 않는다.
// - 프롬프트는 argv 가 아니라 **stdin 으로 전달** — argv 는 `ps aux` 로 유출될 수 있음 + ARG_MAX 회피.
// - cwd / HOME 모두 throwaway 임시 디렉토리로 격리해 prompt-injected agent 의 repo / ~/.ssh 접근을 차단.

export const buildClaudeArgs = ({
  systemPrompt,
}: {
  systemPrompt?: string;
}): string[] => {
  const args = ['-p', '--output-format', 'json', '--no-session-persistence'];
  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }
  return args;
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

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-claude-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'idaeri-claude-home-'));

    try {
      const args = buildClaudeArgs({ systemPrompt: request.systemPrompt });
      const stdout = await this.spawnClaude({
        args,
        cwd: workDir,
        homeDir,
        stdinPayload: request.prompt,
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
        this.logger.error(
          `claude CLI exit=${code} stderr=${stderrTail.slice(-200)}`,
        );
        reject(
          new Error(
            `claude CLI 비정상 종료 (exit=${code}): ${stderrTail || '(no stderr)'}`,
          ),
        );
      });

      // prompt 는 argv 가 아니라 stdin 으로 전달 — ps aux 노출 방지 + ARG_MAX 제한 회피.
      // claude -p 는 positional prompt 없이 stdin 에서 prompt 를 읽는다 (standard pipe pattern).
      child.stdin?.write(stdinPayload);
      child.stdin?.end();
    });
  }
}
