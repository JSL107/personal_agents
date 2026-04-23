import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const CODEX_EXECUTABLE = 'codex';
const CODEX_DEFAULT_TIMEOUT_MS = 180_000;
const STDERR_TAIL_LIMIT = 500;

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
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-home-'));
    const outputFile = join(workDir, 'response.txt');

    try {
      const args = buildCodexArgs({ outputFile });
      const stdinPayload = buildCodexPrompt(request);
      await this.spawnCodex({ args, cwd: workDir, homeDir, stdinPayload });
      const text = (await readFile(outputFile, 'utf-8')).trim();

      if (text.length === 0) {
        // exit=0 이지만 output-last-message 가 비어있는 드문 상태 — 인증 만료/쿼터 소진/프롬프트 필터링 등에서 관찰됨.
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
  }: {
    args: string[];
    cwd: string;
    homeDir: string;
    stdinPayload: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(CODEX_EXECUTABLE, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: buildSafeChildEnv({ cwd, homeDir }),
      });

      let stdoutTail = '';
      let stderrTail = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`codex CLI 응답 시간 초과 (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutTail = (stdoutTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        const suffix = stderrTail || stdoutTail || '(no output)';
        this.logger.error(`codex CLI exit=${code} tail=${suffix.slice(-200)}`);
        reject(new Error(`codex CLI 비정상 종료 (exit=${code}): ${suffix}`));
      });

      // prompt 는 argv 가 아니라 stdin 으로 전달 — ps aux 노출 방지 + ARG_MAX 제한 회피.
      // codex exec 는 PROMPT 위치 인자가 없으면 stdin 에서 읽는다.
      child.stdin?.write(stdinPayload);
      child.stdin?.end();
    });
  }
}
