import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';

import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { buildSafeChildEnv } from './cli-process.util';
import { redactPii } from './pii-redaction.util';

const GEMINI_EXECUTABLE = 'gemini';
const GEMINI_DEFAULT_TIMEOUT_MS = 180_000;
const STREAM_TAIL_LIMIT = 2000;

// Google Gemini CLI (`gemini`) 어댑터.
// - `-p ""` + stdin 으로 prompt 전달 (argv 노출 회피, ARG_MAX 회피)
// - `-o json` 으로 stdout 에 단일 JSON 응답 (성공: { response/result } / 실패: { error })
// - `--approval-mode plan` 으로 read-only 강제 (도구 호출 차단 — prompt-injection 안전)
// - `--yolo` 미사용 (도구 자동 승인 위험)
// - 인증은 사용자가 OAuth (`gemini` 인터랙티브 1회) 또는 GEMINI_API_KEY 로 미리 설정해야 함

export const buildGeminiArgs = ({
  systemPrompt,
}: {
  systemPrompt?: string;
}): string[] => {
  // 시스템 프롬프트 전용 옵션은 v0.39 기준 없음 — 호출자가 prompt 본문 앞에 붙여 stdin 으로 같이 전달한다.
  // 이 함수는 systemPrompt 인자 자체는 무시하고 args 만 반환 — 합치는 책임은 호출자(complete) 에 있다.
  void systemPrompt;
  return ['-p', '', '-o', 'json', '--approval-mode', 'plan'];
};

export const buildGeminiStdinPayload = ({
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

export const parseGeminiJsonOutput = (
  raw: string,
): { text: string; modelUsed: string } => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error('gemini CLI 가 빈 응답을 반환했습니다.');
  }

  const parsed = JSON.parse(trimmed) as {
    response?: unknown;
    result?: unknown;
    text?: unknown;
    model?: unknown;
    stats?: { model?: unknown };
    error?: { message?: unknown; type?: unknown; code?: unknown };
  };

  if (parsed.error) {
    const message =
      typeof parsed.error.message === 'string'
        ? parsed.error.message
        : JSON.stringify(parsed.error);
    throw new Error(`gemini CLI error: ${message}`);
  }

  // 키 후보 순서대로 시도 — gemini CLI 버전마다 응답 키가 약간 다르다.
  const text = pickFirstString([parsed.response, parsed.result, parsed.text]);
  if (text === null) {
    throw new Error(
      `gemini CLI 응답에 response/result/text 필드가 없음: ${trimmed.slice(0, 300)}`,
    );
  }

  const modelUsed =
    pickFirstString([parsed.model, parsed.stats?.model]) ?? 'gemini-cli';

  return { text, modelUsed };
};

const pickFirstString = (candidates: unknown[]): string | null => {
  for (const value of candidates) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
};

@Injectable()
export class GeminiCliProvider implements ModelProviderPort {
  readonly name = ModelProviderName.GEMINI;
  private readonly logger = new Logger(GeminiCliProvider.name);
  private readonly timeoutMs: number = GEMINI_DEFAULT_TIMEOUT_MS;

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-gemini-'));

    // codex/claude 는 CODEX_HOME / CLAUDE_CONFIG_DIR 같은 인증 디렉토리 override 환경변수가 있어
    // throwaway HOME + 인증 dir 명시 forward 패턴이 가능하다. Gemini CLI 는 그 메커니즘이 없고
    // 무조건 os.homedir()/.gemini 만 읽으므로 throwaway 시 OAuth 인증 (~/.gemini/oauth_creds.json)
    // 을 못 찾는다. 따라서 Gemini 는 사용자 실제 HOME 을 그대로 쓴다 — `--approval-mode plan` 으로
    // 도구 호출이 차단돼 있어 prompt-injected agent 가 ~/.ssh 등을 직접 읽을 surface 가 없다.
    const homeDir = process.env.HOME ?? homedir();

    try {
      const args = buildGeminiArgs({ systemPrompt: request.systemPrompt });
      // OPS-4: 외부 CLI 로 stdin 흘려보내기 직전 토큰 류 시크릿 redact.
      const stdinPayload = redactPii(
        buildGeminiStdinPayload({
          prompt: request.prompt,
          systemPrompt: request.systemPrompt,
        }),
      );
      const stdout = await this.spawnGemini({
        args,
        cwd: workDir,
        homeDir,
        stdinPayload,
      });
      const { text, modelUsed } = parseGeminiJsonOutput(stdout);

      return { text, modelUsed, provider: ModelProviderName.GEMINI };
    } finally {
      // workDir 만 cleanup — homeDir 은 사용자 실제 $HOME 이라 절대 rm 하면 안 된다.
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // prompt-injection 방어 / 시크릿 격리: cwd + HOME 모두 throwaway, env 는 allowlist.
  private spawnGemini({
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
      const child = spawn(GEMINI_EXECUTABLE, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: buildSafeChildEnv({ cwd, homeDir }),
      });

      const stdoutChunks: string[] = [];
      let stderrTail = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`gemini CLI 응답 시간 초과 (${this.timeoutMs}ms)`));
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
          `gemini CLI exit=${code} stderr=${stderrTail.slice(-200)}`,
        );
        reject(
          new Error(
            `gemini CLI 비정상 종료 (exit=${code}): ${stderrTail || '(no stderr)'}`,
          ),
        );
      });

      child.stdin?.write(stdinPayload);
      child.stdin?.end();
    });
  }
}
