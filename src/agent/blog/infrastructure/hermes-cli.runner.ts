import { spawn } from 'node:child_process';

import { Injectable, Logger } from '@nestjs/common';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  buildSafeChildEnv,
  getRealHomeDir,
} from '../../../model-router/infrastructure/cli-process.util';
import { redactPii } from '../../../model-router/infrastructure/pii-redaction.util';
import { BlogException } from '../domain/blog.exception';
import { BlogErrorCode } from '../domain/blog-error-code.enum';
import {
  HermesRunnerPort,
  HermesRunResult,
} from '../domain/port/hermes-runner.port';

const HERMES_EXECUTABLE = 'hermes';
const HERMES_TIMEOUT_MS = 300_000;
const STDERR_TAIL_LIMIT = 1000;

// 이대리 → Hermes 헤드리스 릴레이. `hermes -z <prompt>` 를 spawn 한다.
// - 실제 HOME 주입 → Hermes 가 ~/.hermes(config/auth/skills/.env)를 찾는다.
//   단 buildSafeChildEnv allowlist 라 이대리 시크릿(SLACK_BOT_TOKEN/DATABASE_URL 등)은 격리.
// - BLOG_NOTIFY_SLACK=0 → tistory-blog 스킬이 자체 Slack DM 을 생략(이대리가 직접 답장).
// - 프롬프트는 argv 전달(hermes -z 는 stdin 경로 없음) — 주제는 토큰이 아니나 방어적으로 redact.
@Injectable()
export class HermesCliRunner implements HermesRunnerPort {
  private readonly logger = new Logger(HermesCliRunner.name);

  run(prompt: string): Promise<HermesRunResult> {
    const safePrompt = redactPii(prompt);
    return new Promise((resolve, reject) => {
      const child = spawn(HERMES_EXECUTABLE, ['-z', safePrompt], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: buildSafeChildEnv({
          homeDir: getRealHomeDir(),
          additionalEnv: { BLOG_NOTIFY_SLACK: '0' },
        }),
      });

      let stdout = '';
      let stderrTail = '';

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(
          new BlogException({
            code: BlogErrorCode.HERMES_TIMEOUT,
            message: `Hermes 실행 시간 초과 (${HERMES_TIMEOUT_MS}ms). 잠시 후 다시 시도해주세요.`,
            status: DomainStatus.INTERNAL,
          }),
        );
      }, HERMES_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-STDERR_TAIL_LIMIT);
      });

      child.on('error', (error) => {
        clearTimeout(timer);
        reject(
          new BlogException({
            code: BlogErrorCode.HERMES_SPAWN_FAILED,
            message: `Hermes CLI 실행 실패: ${error.message}`,
            status: DomainStatus.INTERNAL,
            cause: error,
          }),
        );
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout: stdout.trim(), stderr: stderrTail });
          return;
        }
        this.logger.error(
          `hermes -z exit=${code} stderrTail=${stderrTail.slice(-300)}`,
        );
        reject(
          new BlogException({
            code: BlogErrorCode.HERMES_NONZERO_EXIT,
            message: `Hermes 비정상 종료 (exit=${code}): ${stderrTail.slice(-200) || '(no stderr)'}`,
            status: DomainStatus.INTERNAL,
          }),
        );
      });
    });
  }
}
