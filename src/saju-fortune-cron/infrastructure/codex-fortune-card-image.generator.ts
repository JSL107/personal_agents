import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable } from '@nestjs/common';

import {
  buildSafeChildEnv,
  getCodexHomeDir,
  killProcessTree,
  writeStdinAndClose,
} from '../../model-router/infrastructure/cli-process.util';
import {
  buildCodexPermissionArgs,
  CODEX_MODEL,
} from '../../model-router/infrastructure/codex-cli.provider';
import { FortuneCardImagePort } from '../domain/port/fortune-card-image.port';

// 2026-11-02 실측 46~60초. 받는 사람마다 한 장이라 넉넉히 둔다.
const IMAGE_TIMEOUT_MS = 240_000;
// 그림 품질은 이 값과 무관하고, 지시를 따르는 데 깊은 추론이 필요 없다.
const IMAGE_REASONING_EFFORT = 'low';
// thread id 는 경로 조각으로 쓰이므로 형식을 확인한다(`..` 같은 값이 섞이지 않게).
const THREAD_ID_PATTERN = /^[0-9a-f-]{16,64}$/;
const STDERR_TAIL_LIMIT = 2_000;

export const extractThreadId = (jsonLines: string): string | undefined => {
  for (const line of jsonLines.split('\n')) {
    if (!line.startsWith('{')) {
      continue;
    }
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: string };
      if (
        event.type === 'thread.started' &&
        typeof event.thread_id === 'string' &&
        THREAD_ID_PATTERN.test(event.thread_id)
      ) {
        return event.thread_id;
      }
    } catch {
      // 진행 로그 줄 — 건너뛴다.
    }
  }
  return undefined;
};

// 구독 codex CLI 의 이미지 생성 도구로 운세 카드를 그린다. 운영 codex 호출과 같은 격리
// (buildSafeChildEnv·throwaway HOME·읽기 잠금 프로필·stdin 프롬프트)를 그대로 쓴다.
// 생성된 그림은 codex 가 `$CODEX_HOME/generated_images/<thread id>/` 에 저장한다. 잠금 프로필이
// 쓰기를 막아 모델이 파일을 옮길 수 없으므로, thread id 로 그 폴더를 찾아 앱이 직접 읽고 지운다.
@Injectable()
export class CodexFortuneCardImageGenerator implements FortuneCardImagePort {
  async generate(prompt: string): Promise<Buffer> {
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-home-'));
    let imageDir: string | undefined;
    try {
      const output = await this.spawnCodex({ workDir, homeDir, prompt });
      const threadId = extractThreadId(output);
      if (!threadId) {
        throw new Error('codex 그림 생성 — thread id 를 찾지 못함');
      }
      imageDir = join(getCodexHomeDir(), 'generated_images', threadId);
      const png = (await readdir(imageDir).catch(() => [])).find((name) =>
        name.endsWith('.png'),
      );
      if (!png) {
        throw new Error('codex 그림 생성 — 생성된 PNG 가 없음');
      }
      return await readFile(join(imageDir, png));
    } finally {
      await Promise.all(
        [workDir, homeDir, imageDir]
          .filter((dir): dir is string => dir !== undefined)
          .map((dir) => rm(dir, { recursive: true, force: true })),
      );
    }
  }

  private spawnCodex({
    workDir,
    homeDir,
    prompt,
  }: {
    workDir: string;
    homeDir: string;
    prompt: string;
  }): Promise<string> {
    const args = [
      'exec',
      '--skip-git-repo-check',
      ...buildCodexPermissionArgs({ workDir }),
      '--ephemeral',
      // 사용자 config 의 MCP 서버·hook 이 따라오지 않게 한다 — 이유는 codex-cli.provider 의 buildCodexArgs 참조.
      '--ignore-user-config',
      '-c',
      `model="${CODEX_MODEL}"`,
      '-c',
      `model_reasoning_effort="${IMAGE_REASONING_EFFORT}"`,
      '--color',
      'never',
      // thread.started 이벤트에서 thread id(= 그림 폴더 이름)를 읽는다.
      '--json',
    ];
    return new Promise((resolve, reject) => {
      const child = spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workDir,
        env: buildSafeChildEnv({ cwd: workDir, homeDir }),
        detached: true,
      });
      let stdout = '';
      let stderrTail = '';
      const timer = setTimeout(() => {
        killProcessTree(child.pid);
        reject(new Error(`codex 그림 생성 시간 초과 (${IMAGE_TIMEOUT_MS}ms)`));
      }, IMAGE_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
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
        if (code !== 0) {
          reject(
            new Error(`codex 그림 생성 실패 (exit=${code}): ${stderrTail}`),
          );
          return;
        }
        resolve(stdout);
      });
      writeStdinAndClose({ child, payload: prompt });
    });
  }
}
