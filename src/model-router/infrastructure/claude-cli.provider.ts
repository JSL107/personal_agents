import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { LLM_CLI_TIMEOUT_MS } from '../../common/llm/llm-timeout.constant';
import {
  CompletionRequest,
  CompletionResponse,
  ModelProviderName,
} from '../domain/model-router.type';
import { ModelProviderPort } from '../domain/port/model-provider.port';
import { buildSafeChildEnv, getRealHomeDir } from './cli-process.util';
import { redactPii } from './pii-redaction.util';

const CLAUDE_EXECUTABLE = 'claude';
// 공유 상수 — worker lockDuration(common/queue/worker-options.constant.ts) 도 이 값을 참조한다.
const CLAUDE_DEFAULT_TIMEOUT_MS = LLM_CLI_TIMEOUT_MS;
const STREAM_TAIL_LIMIT = 2000;

// Claude Max 구독 기반의 claude CLI 를 print 모드(`-p`)로 호출하는 어댑터.
// Code Reviewer / BE 에이전트가 사용하는 경로 (기획서 §13). Claude Max 구독 쿼터로 동작.
// - 출력은 --output-format json 으로 stdout 에 단일 JSON 객체 (`{ result: "..." }`) 를 떨어뜨린다.
// - `--bare` 플래그 / `CLAUDE_CODE_SIMPLE=1` 환경변수는 안 쓴다. docs 의 Bare/SIMPLE 모드는
//   `ANTHROPIC_API_KEY` (Claude Console 발급 sk-ant-api03-) 또는 `apiKeyHelper` 만 받음 —
//   `setup-token` 의 OAuth subscription token (sk-ant-oat01-) 은 "Invalid API key" 로 거부.
//   2026-06-05 manual test 로 확정 (4개 env 조합 중 `CLAUDE_CODE_OAUTH_TOKEN` 만 동작).
// - 인증 경로는 두 가지:
//     A) 기본 (subscription/keychain): parent 의 keychain ACL 에 봇 binary 가 등록돼 OAuth
//        access 가능할 때. 사용자가 supervisor 로 봇을 실행하면 keychain dialog 가 한 번 떠 ACL
//        등록되는 케이스가 일반적.
//     B) OAuth token (권장 — ACL 우회): `CLAUDE_CODE_OAUTH_TOKEN` (또는 `ANTHROPIC_API_KEY`
//        alias) env 에 `claude setup-token` 발급 token 을 두면, docs precedence 에서
//        priority 5 (OAUTH_TOKEN) > priority 6 (keychain) 이라 keychain 시도 자체가 안 일어남.
//        ACL 미등록 환경 (nest start --watch 같은 child PID 변동) 의 침묵 exit=1 자연 우회.
// - 프롬프트는 argv 가 아니라 **stdin 으로 전달** — argv 는 `ps aux` 로 유출될 수 있음 + ARG_MAX 회피.
// - cwd 는 throwaway 임시 디렉토리로 격리해 prompt-injected agent 의 repo 접근을 차단.
//   HOME 은 real (A 경로 keychain context 보존) — `~/.ssh` 등은 file system 권한으로 보호.

// 이대리가 Claude 를 쓰는 건 개발형 에이전트 (BE, Code Reviewer) 뿐이라 기본 `opus` 로 격상.
// 구독 quota 소진 우려가 있으면 env 로 `sonnet` / `haiku` override 가능.
const DEFAULT_CLAUDE_MODEL = 'opus';

// `claude setup-token` 으로 발급한 OAuth subscription token (`sk-ant-oat01-...`) 을 자식 env 로 forward.
// docs precedence (code.claude.com/docs/en/iam): priority 5 = `CLAUDE_CODE_OAUTH_TOKEN`,
// priority 6 = subscription OAuth from keychain. priority 5 가 위라 keychain 시도 자체가 일어나지 않음
// → keychain ACL 미등록 환경 (nest start --watch 의 PID 변동 child) 의 침묵 exit=1 자연 우회.
//
// 이전 시도 (PR #71): `CLAUDE_CODE_SIMPLE=1` + `ANTHROPIC_API_KEY` 조합. docs 의 Bare/SIMPLE mode
// 안내는 "ANTHROPIC_API_KEY or apiKeyHelper" 만 지원 — OAuth subscription token (sk-ant-oat01-) 을
// 그 경로로 보내면 server 가 "Invalid API key" 로 거부 (2026-06-05 manual test 확인). API key
// (`sk-ant-api03-`, Claude Console 발급) 만 받는 경로라 Max 구독자 봇 환경엔 부적합. SIMPLE 안 켜고
// OAUTH_TOKEN 만 forward 하는 게 정통.
export const buildClaudeAdditionalEnv = (
  oauthToken?: string,
): NodeJS.ProcessEnv => {
  if (!oauthToken || oauthToken.length === 0) {
    return {};
  }
  return { CLAUDE_CODE_OAUTH_TOKEN: oauthToken };
};

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
    // keychain 경로 (A) 보존: throwaway HOME 으로 바꾸면 keychain access context 가 깨져
    // 침묵 exit=1. real HOME 사용 — `~/.ssh` 등은 fs 권한 + cwd 격리로 보호.
    const homeDir = getRealHomeDir();

    try {
      const model = this.configService.get<string>('CLAUDE_MODEL')?.trim();
      // OAuth token 경로 (B) — `claude setup-token` 으로 발급한 subscription OAuth token.
      // env 로 직접 주입하면 keychain (priority 6) 보다 위 (priority 5) 라 ACL 우회 자연 성립.
      // ConfigService 가 두 env name 다 받음 — docs 정통 = `CLAUDE_CODE_OAUTH_TOKEN`,
      // PR #71 시점에 `ANTHROPIC_API_KEY` 로 안내됐던 사용자 .env 도 fallback 으로 호환 유지.
      const oauthToken =
        this.configService.get<string>('CLAUDE_CODE_OAUTH_TOKEN')?.trim() ||
        this.configService.get<string>('ANTHROPIC_API_KEY')?.trim() ||
        undefined;
      // OPS-4: stdin (사용자 입력 경로) 뿐 아니라 --system-prompt argv 까지 redact —
      // 정적 상수만 들어오는 경로지만 codex 와 동일 정책으로 일관성 유지 (codex P1 지적).
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
        oauthToken,
      });
      const { text, modelUsed } = parseClaudeJsonOutput(stdout);

      return {
        text,
        modelUsed,
        provider: ModelProviderName.CLAUDE,
      };
    } finally {
      // real HOME 은 봇 소유 아님 — rm 금지. workDir 만 정리.
      await rm(workDir, { recursive: true, force: true });
    }
  }

  private spawnClaude({
    args,
    cwd,
    homeDir,
    stdinPayload,
    oauthToken,
  }: {
    args: string[];
    cwd: string;
    homeDir: string;
    stdinPayload: string;
    oauthToken?: string;
  }): Promise<string> {
    return new Promise((resolve, reject) => {
      const additionalEnv = buildClaudeAdditionalEnv(oauthToken);
      const child = spawn(CLAUDE_EXECUTABLE, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd,
        env: buildSafeChildEnv({ cwd, homeDir, additionalEnv }),
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
