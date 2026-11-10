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
// thread_id 는 `--json` 의 thread.started 이벤트(첫 줄)에만 있는 필드라 JSON 을 풀지 않고 바로 찾는다
// (codex-cli 0.166.0 실측: 압축 JSON, thread_id 를 가진 줄은 하나). 직렬화 공백이 바뀌어도 읽히게 \s* 를 둔다.
// 문자 집합을 묶는 것은 이 값이 경로 조각이 되기 때문이다(`..` 같은 값이 섞이지 않게).
const THREAD_ID_PATTERN = /"thread_id"\s*:\s*"([0-9a-f-]{16,64})"/;
const STDERR_TAIL_LIMIT = 2_000;

export const extractThreadId = (output: string): string | undefined =>
  THREAD_ID_PATTERN.exec(output)?.[1];

interface CodexRunResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderrTail: string;
}

const removeDir = (dir: string): Promise<void> =>
  rm(dir, { recursive: true, force: true });

// 구독 codex CLI 의 이미지 생성 도구로 운세 카드를 그린다. 운영 codex 호출과 같은 격리
// (buildSafeChildEnv·throwaway HOME·읽기 잠금 프로필·stdin 프롬프트)를 그대로 쓴다.
// 생성된 그림은 codex 가 `$CODEX_HOME/generated_images/<thread id>/` 에 저장한다. 잠금 프로필이
// 쓰기를 막아 모델이 파일을 옮길 수 없으므로, thread id 로 그 폴더를 찾아 앱이 직접 읽고 지운다.
@Injectable()
export class CodexFortuneCardImageGenerator implements FortuneCardImagePort {
  async generate(prompt: string): Promise<Buffer> {
    const workDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-'));
    const homeDir = await mkdtemp(join(tmpdir(), 'idaeri-codex-home-'));
    const run = await this.runCodex({ workDir, homeDir, prompt }).finally(() =>
      Promise.all([removeDir(workDir), removeDir(homeDir)]),
    );
    // 실패(시간 초과·비정상 종료)해도 그림이 이미 저장됐을 수 있어, 폴더는 결과와 무관하게 먼저 정하고 지운다.
    const threadId = extractThreadId(run.stdout);
    const imageDir = threadId
      ? join(getCodexHomeDir(), 'generated_images', threadId)
      : undefined;
    try {
      if (run.timedOut || run.exitCode !== 0) {
        const reason = run.timedOut
          ? `시간 초과 ${IMAGE_TIMEOUT_MS}ms`
          : `exit=${run.exitCode}`;
        throw new Error(`codex 그림 생성 실패 (${reason}): ${run.stderrTail}`);
      }
      if (!imageDir) {
        throw new Error('codex 그림 생성 — thread id 를 찾지 못함');
      }
      const png = (await readdir(imageDir).catch(() => [])).find((name) =>
        name.endsWith('.png'),
      );
      if (!png) {
        throw new Error('codex 그림 생성 — 생성된 PNG 가 없음');
      }
      return await readFile(join(imageDir, png));
    } finally {
      if (imageDir) {
        await removeDir(imageDir);
      }
    }
  }

  // 종료 코드·시간 초과는 거부하지 않고 결과로 돌려준다 — 실패한 회차의 출력에서도 그림 폴더를 찾아 지워야 한다.
  // execFile 대신 spawn 을 쓰는 이유: 시간 초과 때 codex 가 띄운 손자 프로세스까지 그룹째 죽여야
  // 'close' 가 온다(killProcessTree 주석 참조). execFile 의 timeout 은 자식 하나만 죽인다.
  private runCodex({
    workDir,
    homeDir,
    prompt,
  }: {
    workDir: string;
    homeDir: string;
    prompt: string;
  }): Promise<CodexRunResult> {
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
    const run = new Promise<CodexRunResult>((resolve, reject) => {
      const child = spawn('codex', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: workDir,
        env: buildSafeChildEnv({ cwd: workDir, homeDir }),
        detached: true,
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const resultOf = ({
        exitCode,
        timedOut,
      }: {
        exitCode: number | null;
        timedOut: boolean;
      }): CodexRunResult => ({
        exitCode,
        timedOut,
        stdout: Buffer.concat(stdoutChunks).toString(),
        stderrTail: Buffer.concat(stderrChunks)
          .toString()
          .slice(-STDERR_TAIL_LIMIT),
      });
      // 먼저 온 쪽만 반영된다 — 시간 초과 뒤의 'close' 는 Promise 가 무시한다.
      const timer = setTimeout(() => {
        killProcessTree(child.pid);
        resolve(resultOf({ exitCode: null, timedOut: true }));
      }, IMAGE_TIMEOUT_MS);
      child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(resultOf({ exitCode: code, timedOut: false }));
      });
      writeStdinAndClose({ child, payload: prompt });
    });
    return run;
  }
}
